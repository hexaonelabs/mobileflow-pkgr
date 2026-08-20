import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirestoreService } from '../firestore/firestore.service';
import { BUILDS_COLLECTION, BuildStatus, type BuildDocument } from '../builds/build.model';
import { BuildsService } from '../builds/builds.service';
import { PROJECTS_COLLECTION, type ProjectDocument } from '../projects/project.model';

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

@Injectable()
export class GithubWebhookService {
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
}
