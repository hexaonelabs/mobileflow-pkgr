import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import AdmZip from 'adm-zip';
import bplistParser from 'bplist-parser';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { AnalyticsService } from '../analytics/analytics.service';
import { GithubService } from '../github/github.service';
import { MOBILEFLOW_WORKFLOW_FILENAME } from '../github/workflow-template';
import { FirestoreService } from '../firestore/firestore.service';
import { LogsTokensService } from '../internal/logs-tokens.service';
import { RunTokensService } from '../internal/run-tokens.service';
import { NotificationsService } from '../notifications/notifications.service';
import { Platform, PROJECTS_COLLECTION, type ProjectDocument } from '../projects/project.model';
import { StorageService } from '../storage/storage.service';
import { Plan } from '../users/user.model';
import {
  BUILDS_COLLECTION,
  BuildStatus,
  Environment,
  TriggeredBy,
  type BuildDocument,
  type BuildResponse,
} from './build.model';
import type { CreateBuildDto } from './dto/create-build.dto';
import { BuildStatusChangedEvent } from './events/build-status-changed.event';

const ARTIFACT_DOWNLOAD_URL_TTL_MS = 15 * 60 * 1000;
// Un build terminé n'a plus de nouvelles lignes : le texte GitHub ne change plus, donc un cache
// évite de re-télécharger l'intégralité des logs à chaque ouverture de page dans la même minute.
// Pendant la phase active, getBuildLogs() ne fait plus aucun appel GitHub (cf. liveLogsBuffer).
const LOGS_CACHE_TTL_FINISHED_MS = 60 * 1000;
// Buffer de logs "live" poussé par le shipper du workflow pendant qu'un job tourne (cf.
// BuildLogsIngestionController) — couvre la fenêtre où GitHub Actions n'a encore rien à
// donner (job in_progress). Volontairement en mémoire process, jamais persisté : son seul rôle
// est ce pont temporaire, le texte GitHub officiel fait autorité une fois le build terminé.
const LIVE_LOGS_MAX_CHARS = 5 * 1024 * 1024;
const LIVE_LOGS_GRACE_MS = 5 * 60 * 1000;
// Filet de sécurité si un build ne passe jamais par finalizeBuildStatus (run GitHub orphelin,
// etc.) : borne la durée de vie du buffer même sans transition de statut observée.
const LIVE_LOGS_ACTIVE_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class BuildsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly githubService: GithubService,
    private readonly runTokensService: RunTokensService,
    private readonly logsTokensService: LogsTokensService,
    private readonly storageService: StorageService,
    private readonly config: ConfigService,
    private readonly analyticsService: AnalyticsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // Cache process local (pas Redis) : le volume d'appels de ce endpoint reste faible et
  // mono-instance suffit largement à absorber le cas visé (plusieurs onglets ouverts sur le
  // même build) — introduire une dépendance Redis pour quelques secondes de cache serait une
  // abstraction prématurée. À revoir si l'API tourne un jour en plusieurs instances.
  private readonly logsCache = new Map<
    string,
    { text: string; expired: boolean; expiresAt: number }
  >();
  private readonly liveLogsBuffer = new Map<string, { text: string; expiresAt: number }>();

  private get builds() {
    return this.firestore.db.collection(BUILDS_COLLECTION);
  }

  private async getOwnedProject(userId: string, projectId: string): Promise<ProjectDocument> {
    const doc = await this.firestore.db.collection(PROJECTS_COLLECTION).doc(projectId).get();
    const data = doc.data() as ProjectDocument | undefined;
    if (!doc.exists || !data || data.userId !== userId) {
      throw new NotFoundException('Projet introuvable.');
    }
    return data;
  }

  async create(userId: string, projectId: string, plan: Plan, dto: CreateBuildDto) {
    const project = await this.getOwnedProject(userId, projectId);
    if (dto.environment === Environment.production && plan === Plan.free) {
      throw new ForbiddenException(
        'Les builds de production nécessitent un plan payant (Starter ou supérieur). Passez à un plan supérieur pour publier sur les stores.',
      );
    }
    const commitSha = await this.githubService.getBranchHeadSha(
      userId,
      project.githubRepoFullName,
      dto.branch,
    );
    await this.githubService.ensureWorkflowInstalled(
      userId,
      project.githubRepoFullName,
      dto.branch,
    );

    return Promise.all(
      dto.platforms.map((platform) =>
        this.createSingle(userId, projectId, project, dto, platform, commitSha),
      ),
    );
  }

  private async createSingle(
    userId: string,
    projectId: string,
    project: ProjectDocument,
    dto: CreateBuildDto,
    platform: Platform,
    commitSha: string,
  ) {
    const now = FieldValue.serverTimestamp();
    const doc: BuildDocument = {
      projectId,
      userId,
      triggeredBy: TriggeredBy.manual,
      environment: dto.environment,
      platform,
      branch: dto.branch,
      commitSha,
      envVars: dto.envVars ?? {},
      status: BuildStatus.queued,
      githubRunId: null,
      githubJobId: null,
      startedAt: null,
      finishedAt: null,
      durationSeconds: null,
      artifactUrl: null,
      logsUrl: null,
      artifactStoragePath: null,
      artifactUploadedAt: null,
      bundleId: null,
      bundleVersion: null,
      createdAt: now,
    };
    const ref = await this.builds.add(doc);

    const inputs: Record<string, string> = {
      build_id: ref.id,
      environment: dto.environment,
      platform,
      // Toujours fournis : le shipper de logs du workflow (cf. workflow-template.ts) en a
      // besoin pour tout build, pas seulement ceux qui signent.
      api_url: this.config.getOrThrow<string>('API_URL'),
      logs_token: await this.logsTokensService.issueToken({ buildId: ref.id, projectId, userId }),
    };
    // Les secrets de signature (certificat/provisioning profile iOS, keystore Android) ne sont
    // jamais committés dans le repo : le run les récupère à l'exécution via un token de run à
    // courte durée de vie (cf. src/internal/). iOS signe systématiquement (Ad Hoc en staging,
    // App Store en production — cf. IOS_SIGNING_ENVIRONMENTS_PLAN.md) ; Android ne signe qu'en
    // production — le staging reste un `assembleDebug` non signé, sans appel réseau.
    const needsSigningSecrets =
      platform === Platform.ios ||
      (platform === Platform.android && dto.environment === Environment.production);
    if (needsSigningSecrets) {
      const secretsToken = await this.runTokensService.issueToken({
        buildId: ref.id,
        projectId,
        userId,
        platform,
        environment: dto.environment,
      });
      inputs.secrets_token = secretsToken;
    }

    await this.githubService.dispatchWorkflowWithRetry(
      userId,
      project.githubRepoFullName,
      dto.branch,
      MOBILEFLOW_WORKFLOW_FILENAME,
      inputs,
    );

    const runId = await this.githubService.correlateWorkflowRun(
      userId,
      project.githubRepoFullName,
      ref.id,
    );
    if (runId !== null) {
      await ref.update({ githubRunId: runId });
    }

    const finalDoc = await ref.get();
    return this.toApiBuild(ref.id, finalDoc.data() as BuildDocument);
  }

  async findAllForProject(userId: string, projectId: string): Promise<BuildResponse[]> {
    await this.getOwnedProject(userId, projectId);
    const snapshot = await this.builds.where('projectId', '==', projectId).get();
    const items = snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() as BuildDocument }));
    return items
      .sort((a, b) => this.toMillis(b.data.createdAt) - this.toMillis(a.data.createdAt))
      .map(({ id, data }) => this.toApiBuild(id, data));
  }

  async findOne(userId: string, projectId: string, buildId: string): Promise<BuildResponse> {
    await this.getOwnedProject(userId, projectId);
    const doc = await this.builds.doc(buildId).get();
    const data = doc.data() as BuildDocument | undefined;
    if (!doc.exists || !data || data.projectId !== projectId) {
      throw new NotFoundException('Build introuvable.');
    }
    return this.toApiBuild(buildId, data);
  }

  async getArtifactDownloadUrl(
    userId: string,
    projectId: string,
    buildId: string,
  ): Promise<{ url: string }> {
    await this.getOwnedProject(userId, projectId);
    const doc = await this.builds.doc(buildId).get();
    const data = doc.data() as BuildDocument | undefined;
    if (!doc.exists || !data || data.projectId !== projectId) {
      throw new NotFoundException('Build introuvable.');
    }
    if (!data.artifactStoragePath) {
      throw new NotFoundException('Aucun artefact hébergé disponible pour ce build.');
    }
    const url = await this.storageService.getSignedDownloadUrl(
      data.artifactStoragePath,
      ARTIFACT_DOWNLOAD_URL_TTL_MS,
    );
    return { url };
  }

  // Hébergement à la demande (clic sur "Installer") plutôt que systématique à chaque build :
  // l'artefact GitHub Actions (zip, gratuit, déjà là) sert de source ; on ne le décompresse et
  // ne le dépose sur Firebase Storage — payant — que si l'utilisateur veut réellement l'installer.
  // Idempotent : si déjà hébergé, retourne le build tel quel sans repasser par GitHub/Storage.
  async ensureHostedArtifact(userId: string, projectId: string, buildId: string) {
    const project = await this.getOwnedProject(userId, projectId);
    const ref = this.builds.doc(buildId);
    const doc = await ref.get();
    const data = doc.data() as BuildDocument | undefined;
    if (!doc.exists || !data || data.projectId !== projectId) {
      throw new NotFoundException('Build introuvable.');
    }
    if (data.artifactStoragePath) {
      return this.toApiBuild(buildId, data);
    }
    if (data.environment !== Environment.staging) {
      throw new BadRequestException(
        "L'installation OTA n'est disponible que pour les builds staging (Ad Hoc).",
      );
    }
    if (data.status !== BuildStatus.success || data.githubRunId === null) {
      throw new BadRequestException("Ce build n'a pas abouti.");
    }

    const zipBuffer = await this.githubService.downloadRunArtifactZip(
      userId,
      project.githubRepoFullName,
      data.githubRunId,
      `mobileflow-${buildId}-${data.platform}`,
    );
    const extension = data.platform === Platform.ios ? 'ipa' : 'apk';
    const zip = new AdmZip(zipBuffer);
    const entry = zip.getEntries().find((item) => item.entryName.endsWith(`.${extension}`));
    if (!entry) {
      throw new NotFoundException("Binaire introuvable dans l'archive GitHub.");
    }
    const fileBuffer = entry.getData();

    const update: Partial<BuildDocument> = {};
    if (data.platform === Platform.ios) {
      const metadata = this.extractIosMetadata(fileBuffer);
      update.bundleId = metadata.bundleId;
      update.bundleVersion = metadata.bundleVersion;
    }

    const storagePath = `builds/${projectId}/${buildId}/app.${extension}`;
    await this.storageService.uploadBuffer(storagePath, fileBuffer, 'application/octet-stream');
    update.artifactStoragePath = storagePath;
    update.artifactUploadedAt = FieldValue.serverTimestamp();

    await ref.update(update);
    const refreshed = await ref.get();
    return this.toApiBuild(buildId, refreshed.data() as BuildDocument);
  }

  private extractIosMetadata(ipaBuffer: Buffer): {
    bundleId: string | null;
    bundleVersion: string | null;
  } {
    try {
      const ipaZip = new AdmZip(ipaBuffer);
      const infoPlistEntry = ipaZip
        .getEntries()
        .find((item) => /^Payload\/[^/]+\.app\/Info\.plist$/.test(item.entryName));
      if (!infoPlistEntry) {
        return { bundleId: null, bundleVersion: null };
      }
      const [parsed] = bplistParser.parseBuffer<Record<string, unknown>>(infoPlistEntry.getData());
      const bundleId = parsed?.['CFBundleIdentifier'];
      const bundleVersion = parsed?.['CFBundleShortVersionString'];
      return {
        bundleId: typeof bundleId === 'string' ? bundleId : null,
        bundleVersion: typeof bundleVersion === 'string' ? bundleVersion : null,
      };
    } catch {
      return { bundleId: null, bundleVersion: null };
    }
  }

  async refreshStatus(userId: string, projectId: string, buildId: string) {
    const project = await this.getOwnedProject(userId, projectId);
    const ref = this.builds.doc(buildId);
    const doc = await ref.get();
    const data = doc.data() as BuildDocument | undefined;
    if (!doc.exists || !data || data.projectId !== projectId) {
      throw new NotFoundException('Build introuvable.');
    }

    let runId = data.githubRunId;
    if (runId === null) {
      runId = await this.githubService.findWorkflowRunId(
        userId,
        project.githubRepoFullName,
        buildId,
      );
      if (runId !== null) {
        await ref.update({ githubRunId: runId });
      }
    }

    if (runId === null) {
      return { id: buildId, ...data };
    }

    const run = await this.githubService.getWorkflowRun(userId, project.githubRepoFullName, runId);
    const { build } = await this.finalizeBuildStatus(userId, projectId, buildId, ref, data, run);
    return build;
  }

  // Lit les logs GitHub Actions du job correspondant à ce build, à la demande (pas d'archivage :
  // chaque appel peut retélécharger le texte depuis GitHub, atténué par logsCache). `offset`
  // permet au polling client de ne recevoir que le delta depuis son dernier appel : GitHub ne
  // renvoie jamais qu'un texte complet, le découpage est fait ici via `.slice(offset)`.
  // Alimenté par BuildLogsIngestionController, appelé par le shipper de logs du workflow
  // pendant qu'un job tourne. Volontairement permissif (pas de validation du contenu) : le
  // contrôleur a déjà vérifié le logs_token et la taille du chunk.
  appendLiveLog(buildId: string, chunk: string): void {
    const now = Date.now();
    for (const [key, entry] of this.liveLogsBuffer) {
      if (entry.expiresAt < now) {
        this.liveLogsBuffer.delete(key);
      }
    }
    const existingText = this.liveLogsBuffer.get(buildId)?.text ?? '';
    if (existingText.length >= LIVE_LOGS_MAX_CHARS) {
      return;
    }
    this.liveLogsBuffer.set(buildId, {
      text: (existingText + chunk).slice(0, LIVE_LOGS_MAX_CHARS),
      expiresAt: now + LIVE_LOGS_ACTIVE_TTL_MS,
    });
  }

  async getBuildLogs(
    userId: string,
    projectId: string,
    buildId: string,
    offset: number,
  ): Promise<{ text: string; nextOffset: number; isComplete: boolean; expired: boolean }> {
    const project = await this.getOwnedProject(userId, projectId);
    const ref = this.builds.doc(buildId);
    const doc = await ref.get();
    const data = doc.data() as BuildDocument | undefined;
    if (!doc.exists || !data || data.projectId !== projectId) {
      throw new NotFoundException('Build introuvable.');
    }

    const isFinished =
      data.status === BuildStatus.success ||
      data.status === BuildStatus.failed ||
      data.status === BuildStatus.cancelled;

    if (!isFinished) {
      // Phase active : uniquement le buffer poussé par le shipper du workflow — aucun appel
      // GitHub, qui de toute façon renvoie 404 tant que le job n'est pas completed (confirmé
      // empiriquement, il n'existe pas d'API publique de streaming pendant l'exécution). Un
      // repo dont le workflow n'a pas été resynchronisé (politique "install once") n'aura
      // jamais rien dans ce buffer : comportement identique à avant cette fonctionnalité.
      const live = this.liveLogsBuffer.get(buildId);
      const text = live?.text ?? '';
      return {
        text: offset < text.length ? text.slice(offset) : '',
        nextOffset: text.length,
        isComplete: false,
        expired: false,
      };
    }

    if (data.githubRunId === null) {
      return { text: '', nextOffset: offset, isComplete: true, expired: false };
    }

    let jobId = data.githubJobId;
    if (jobId === null) {
      jobId = await this.githubService.findRelevantJobId(
        userId,
        project.githubRepoFullName,
        data.githubRunId,
      );
      if (jobId !== null) {
        await ref.update({ githubJobId: jobId });
      }
    }
    if (jobId === null) {
      return { text: '', nextOffset: offset, isComplete: true, expired: false };
    }

    const { text: fullText, expired } = await this.getJobLogsCached(
      userId,
      project.githubRepoFullName,
      jobId,
    );
    if (expired) {
      return { text: '', nextOffset: offset, isComplete: true, expired: true };
    }

    // Le texte GitHub (masqué, horodaté par ligne) n'a pas le même format que le texte brut
    // accumulé dans le buffer live pendant la phase active : pas de continuité d'offset
    // possible entre les deux sources. On renvoie systématiquement le texte complet ; le front
    // remplace sa vue au lieu de l'accumuler dès que isComplete === true (cf. build-detail.ts).
    return { text: fullText, nextOffset: fullText.length, isComplete: true, expired: false };
  }

  private async getJobLogsCached(
    userId: string,
    repoFullName: string,
    jobId: number,
  ): Promise<{ text: string; expired: boolean }> {
    const cacheKey = `${repoFullName}:${jobId}`;
    const cached = this.logsCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return { text: cached.text, expired: cached.expired };
    }

    const result = await this.githubService.downloadJobLogsText(userId, repoFullName, jobId);
    this.logsCache.set(cacheKey, { ...result, expiresAt: now + LOGS_CACHE_TTL_FINISHED_MS });
    return result;
  }

  // Extrait de refreshStatus() : point de finalisation unique, appelable aussi bien depuis le
  // polling client (refreshStatus) que depuis le webhook GitHub (GithubWebhookService) — c'est
  // ici, et nulle part ailleurs, que doit se brancher tout ce qui doit se déclencher exactement
  // une fois quand un build se termine (Analytics, Notifications).
  async finalizeBuildStatus(
    userId: string,
    projectId: string,
    buildId: string,
    ref: FirebaseFirestore.DocumentReference,
    data: BuildDocument,
    run: {
      status: string | null;
      conclusion: string | null;
      htmlUrl: string;
      startedAt: string | null;
      updatedAt: string;
    },
  ) {
    const status = this.mapRunStatus(run.status, run.conclusion);
    const update: Partial<BuildDocument> = { status, logsUrl: run.htmlUrl };

    if (status === BuildStatus.running && !data.startedAt) {
      update.startedAt = FieldValue.serverTimestamp();
    }
    const isFinished =
      status === BuildStatus.success ||
      status === BuildStatus.failed ||
      status === BuildStatus.cancelled;

    // Le webhook GitHub et le polling client (setInterval de build-detail.ts) peuvent
    // tous deux appeler finalizeBuildStatus() pour le même build à quelques millisecondes
    // d'écart, chacun avec son propre `data` déjà lu — donc potentiellement obsolète.
    // Vérifier `!data.finishedAt` sur ce `data` figé n'est PAS atomique : les deux
    // appels peuvent passer le garde-fou et déclencher Analytics/Notifications deux fois
    // pour un seul build. La transaction relit l'état réel de Firestore et ne laisse
    // qu'un seul appelant "gagner" la finalisation.
    let didFinalize = false;
    if (isFinished) {
      const durationSeconds = run.startedAt
        ? Math.max(
            0,
            Math.round(
              (new Date(run.updatedAt).getTime() - new Date(run.startedAt).getTime()) / 1000,
            ),
          )
        : null;

      didFinalize = await this.firestore.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.data() as BuildDocument;
        if (current.finishedAt) {
          return false;
        }
        tx.update(ref, {
          finishedAt: FieldValue.serverTimestamp(),
          ...(durationSeconds !== null ? { durationSeconds } : {}),
        });
        return true;
      });

      if (didFinalize) {
        // Ferme la fenêtre d'ingestion du shipper de logs dès que le job est terminé, et laisse
        // une courte grâce au buffer live (au lieu d'une suppression immédiate) le temps qu'un
        // onglet déjà ouvert termine proprement son dernier cycle de polling.
        await this.logsTokensService.revokeToken(buildId);
        const bufferEntry = this.liveLogsBuffer.get(buildId);
        if (bufferEntry) {
          bufferEntry.expiresAt = Date.now() + LIVE_LOGS_GRACE_MS;
        }

        await this.analyticsService.recordBuild(userId, projectId, {
          platform: data.platform,
          environment: data.environment,
          status,
          durationSeconds,
        });

        await this.notificationsService.onBuildStatusChanged(
          new BuildStatusChangedEvent(
            buildId,
            projectId,
            userId,
            data.platform,
            data.environment,
            status,
            durationSeconds,
            data.status,
          ),
        );
      }
    }
    if (status === BuildStatus.success && !data.artifactUrl) {
      update.artifactUrl = await this.githubService.findArtifactUrl(
        userId,
        (await this.getOwnedProject(userId, projectId)).githubRepoFullName,
        data.githubRunId!,
        `mobileflow-${buildId}-${data.platform}`,
      );
    }

    await ref.update(update);
    const refreshed = await ref.get();
    return {
      isFinished: didFinalize,
      build: this.toApiBuild(buildId, refreshed.data() as BuildDocument),
      update,
    };
  }

  private mapRunStatus(status: string | null, conclusion: string | null): BuildStatus {
    if (status === 'completed') {
      if (conclusion === 'success') {
        return BuildStatus.success;
      }
      if (conclusion === 'cancelled') {
        return BuildStatus.cancelled;
      }
      return BuildStatus.failed;
    }
    if (status === 'in_progress') {
      return BuildStatus.running;
    }
    return BuildStatus.queued;
  }

  private toMillis(value: BuildDocument['createdAt']): number {
    return typeof value === 'object' && value !== null && 'toMillis' in value
      ? value.toMillis()
      : 0;
  }

  // Un FieldValue.serverTimestamp() non résolu (juste avant écriture) ne s'exporte pas en JSON :
  // uniquement les Timestamp effectivement lus depuis Firestore sont convertis en chaîne ISO.
  private toIsoString(value: Timestamp | FieldValue | null): string | null {
    return value instanceof Timestamp ? value.toDate().toISOString() : null;
  }

  private toApiBuild(id: string, data: BuildDocument): BuildResponse {
    return {
      ...data,
      id,
      startedAt: this.toIsoString(data.startedAt),
      finishedAt: this.toIsoString(data.finishedAt),
      createdAt: this.toIsoString(data.createdAt),
      artifactUploadedAt: this.toIsoString(data.artifactUploadedAt),
    };
  }
}
