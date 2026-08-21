import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FieldValue } from 'firebase-admin/firestore';
import { FirestoreService } from '../firestore/firestore.service';
import {
  BUILDS_COLLECTION,
  BuildStatus,
  Environment,
  type BuildDocument,
} from '../builds/build.model';
import { BuildsService } from '../builds/builds.service';
import { Platform, PROJECTS_COLLECTION, type ProjectDocument } from '../projects/project.model';
import { Plan, USERS_COLLECTION, type UserDocument } from '../users/user.model';

export interface WorkflowRunWebhookPayload {
  action: string;
  repository: { full_name: string };
  workflow_run: {
    name: string | null;
    status: string | null;
    conclusion: string | null;
    html_url: string;
    run_started_at: string | null;
    updated_at: string;
  };
}

export interface PushWebhookPayload {
  ref: string; // "refs/heads/<branch>"
  deleted: boolean;
  repository: { full_name: string };
}

@Injectable()
export class GithubWebhookService {
  private readonly logger = new Logger(GithubWebhookService.name);

  constructor(
    private readonly firestore: FirestoreService,
    private readonly buildsService: BuildsService,
    private readonly config: ConfigService,
  ) {}

  verifySignature(rawBody: Buffer, signatureHeader: string): void {
    const secret = this.config.getOrThrow<string>('GITHUB_WEBHOOK_SECRET');
    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Signature invalide.');
    }
  }

  async handleWorkflowRunEvent(payload: WorkflowRunWebhookPayload): Promise<void> {
    if (payload.action !== 'completed') {
      return;
    }

    const repoFullName = payload.repository.full_name;
    const runName = payload.workflow_run.name ?? '';

    const projectSnap = await this.firestore.db
      .collection(PROJECTS_COLLECTION)
      .where('githubRepoFullName', '==', repoFullName)
      .limit(1)
      .get();
    if (projectSnap.empty) {
      return; // Repo non (ou plus) rattaché à un projet MobileFlow.
    }

    const projectDoc = projectSnap.docs[0];
    const project = projectDoc.data() as ProjectDocument;
    const projectId = projectDoc.id;

    const buildsSnap = await this.firestore.db
      .collection(BUILDS_COLLECTION)
      .where('projectId', '==', projectId)
      .where('status', 'in', [BuildStatus.queued, BuildStatus.running])
      .get();
    // Même règle de correspondance que GithubService.findWorkflowRunId : le workflow définit
    // `run-name: "MobileFlow build ${{ inputs.build_id }} (...)"`, donc runName.includes(buildId).
    const buildDoc = buildsSnap.docs.find((d) => runName.includes(d.id));
    if (!buildDoc) {
      return; // Aucun build MobileFlow en attente ne correspond à ce run.
    }

    await this.buildsService.finalizeBuildStatus(
      project.userId,
      projectId,
      buildDoc.id,
      buildDoc.ref,
      buildDoc.data() as BuildDocument,
      {
        status: payload.workflow_run.status,
        conclusion: payload.workflow_run.conclusion,
        htmlUrl: payload.workflow_run.html_url,
        startedAt: payload.workflow_run.run_started_at,
        updatedAt: payload.workflow_run.updated_at,
      },
    );
  }

  async handlePushEvent(payload: PushWebhookPayload): Promise<void> {
    if (payload.deleted) {
      return; // Suppression de branche, rien à builder.
    }
    const branch = payload.ref.replace(/^refs\/heads\//, '');
    const repoFullName = payload.repository.full_name;

    const projectSnap = await this.firestore.db
      .collection(PROJECTS_COLLECTION)
      .where('githubRepoFullName', '==', repoFullName)
      .where('autoTriggerBranch', '==', branch)
      .get();
    if (projectSnap.empty) {
      return; // Aucun projet n'a l'auto-trigger activé pour ce repo+branche.
    }

    // Un projet en échec (ex. ForbiddenException plan gratuit) ne doit pas empêcher les
    // autres projets matchés par ce même push d'être traités.
    const results = await Promise.allSettled(
      projectSnap.docs.map(async (doc) => {
        const project = doc.data() as ProjectDocument;
        const projectId = doc.id;
        const plan = await this.resolvePlan(project.userId);

        await this.cancelStaleBuilds(projectId, branch);

        // Réutilise exactement le chemin d'un clic manuel "Start build" (token de secrets,
        // installation du workflow si absent, entrée d'historique) — jamais un dispatch parallèle.
        await this.buildsService.create(project.userId, projectId, plan, {
          environment: Environment.staging,
          branch,
          platforms: [Platform.android, Platform.ios],
        });
      }),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn(`Échec du déclenchement automatique sur push : ${String(result.reason)}`);
      }
    }
  }

  // FR-6 : "annulation des runs redondants sur pushs rapprochés" — implémenté au niveau
  // MobileFlow plutôt que via un bloc `concurrency:` GitHub Actions (le workflow n'a pas de
  // trigger `on: push` natif, voir la note d'architecture en tête de PHASE_2_TASKS.md).
  // N'annule pas le run GitHub Actions sous-jacent du build superseded : celui-ci continue de
  // s'exécuter côté GitHub, il n'est simplement plus suivi comme le build "courant" ici.
  private async cancelStaleBuilds(projectId: string, branch: string): Promise<void> {
    const staleSnap = await this.firestore.db
      .collection(BUILDS_COLLECTION)
      .where('projectId', '==', projectId)
      .where('branch', '==', branch)
      .where('status', 'in', [BuildStatus.queued, BuildStatus.running])
      .get();
    await Promise.all(
      staleSnap.docs.map((staleDoc) =>
        staleDoc.ref.update({
          status: BuildStatus.cancelled,
          finishedAt: FieldValue.serverTimestamp(),
        }),
      ),
    );
  }

  // Pas de UsersService dans ce codebase (cf. PHASE_1_TASKS.md Task 6.1) : lecture Firestore
  // directe, comme PlanGuard le fait pour les requêtes authentifiées — ici il n'y a pas de JWT
  // puisque l'appelant est GitHub, pas un utilisateur.
  private async resolvePlan(userId: string): Promise<Plan> {
    const doc = await this.firestore.db.collection(USERS_COLLECTION).doc(userId).get();
    const data = doc.data() as UserDocument | undefined;
    return data?.plan ?? Plan.free;
  }
}
