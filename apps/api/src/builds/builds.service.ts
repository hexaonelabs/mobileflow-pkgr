import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import AdmZip from 'adm-zip';
import bplistParser from 'bplist-parser';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { AnalyticsService } from '../analytics/analytics.service';
import { GithubService } from '../github/github.service';
import { MOBILEFLOW_WORKFLOW_FILENAME } from '../github/workflow-template';
import { FirestoreService } from '../firestore/firestore.service';
import { RunTokensService } from '../internal/run-tokens.service';
import { Platform, PROJECTS_COLLECTION, type ProjectDocument } from '../projects/project.model';
import { StorageService } from '../storage/storage.service';
import {
  BUILDS_COLLECTION,
  BuildStatus,
  Environment,
  TriggeredBy,
  type BuildDocument,
  type BuildResponse,
} from './build.model';
import type { CreateBuildDto } from './dto/create-build.dto';

const ARTIFACT_DOWNLOAD_URL_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class BuildsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly githubService: GithubService,
    private readonly runTokensService: RunTokensService,
    private readonly storageService: StorageService,
    private readonly config: ConfigService,
    private readonly analyticsService: AnalyticsService,
  ) {}

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

  async create(userId: string, projectId: string, dto: CreateBuildDto) {
    const project = await this.getOwnedProject(userId, projectId);
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
      startedAt: null,
      finishedAt: null,
      durationSeconds: null,
      artifactUrl: null,
      logsUrl: null,
      artifactStoragePath: null,
      bundleId: null,
      bundleVersion: null,
      createdAt: now,
    };
    const ref = await this.builds.add(doc);

    const inputs: Record<string, string> = {
      build_id: ref.id,
      environment: dto.environment,
      platform,
    };
    // Les secrets de signature (certificat/provisioning profile iOS, keystore Android) ne sont
    // jamais committés dans le repo : le run les récupère à l'exécution via un token de run à
    // courte durée de vie (cf. src/internal/). iOS signe systématiquement (Ad Hoc) ; Android ne
    // signe qu'en production — le staging reste un `assembleDebug` non signé, sans appel réseau.
    const needsSigningSecrets =
      platform === Platform.ios ||
      (platform === Platform.android && dto.environment === Environment.production);
    if (needsSigningSecrets) {
      const secretsToken = await this.runTokensService.issueToken({
        buildId: ref.id,
        projectId,
        userId,
        platform,
      });
      inputs.secrets_token = secretsToken;
      inputs.api_url = this.config.getOrThrow<string>('API_URL');
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

    if (isFinished && !data.finishedAt) {
      update.finishedAt = FieldValue.serverTimestamp();
      if (run.startedAt) {
        const durationMs = new Date(run.updatedAt).getTime() - new Date(run.startedAt).getTime();
        update.durationSeconds = Math.max(0, Math.round(durationMs / 1000));
      }

      await this.analyticsService.recordBuild(userId, projectId, {
        platform: data.platform,
        environment: data.environment,
        status,
        durationSeconds: update.durationSeconds ?? null,
      });
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
      isFinished: isFinished && !data.finishedAt,
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
    };
  }
}
