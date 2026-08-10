import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FieldValue } from 'firebase-admin/firestore';
import { GithubService } from '../github/github.service';
import { MOBILEFLOW_WORKFLOW_FILENAME } from '../github/workflow-template';
import { FirestoreService } from '../firestore/firestore.service';
import { RunTokensService } from '../internal/run-tokens.service';
import { Platform, PROJECTS_COLLECTION, type ProjectDocument } from '../projects/project.model';
import { BUILDS_COLLECTION, BuildStatus, TriggeredBy, type BuildDocument } from './build.model';
import type { CreateBuildDto } from './dto/create-build.dto';

@Injectable()
export class BuildsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly githubService: GithubService,
    private readonly runTokensService: RunTokensService,
    private readonly config: ConfigService,
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
      createdAt: now,
    };
    const ref = await this.builds.add(doc);

    const inputs: Record<string, string> = {
      build_id: ref.id,
      environment: dto.environment,
      platform,
    };
    // Le certificat/provisioning profile iOS ne sont jamais committés dans le repo : le run
    // les récupère à l'exécution via un token de run à courte durée de vie (cf. src/internal/).
    if (platform === Platform.ios) {
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
    return { id: ref.id, ...(finalDoc.data() as BuildDocument) };
  }

  async findAllForProject(userId: string, projectId: string) {
    await this.getOwnedProject(userId, projectId);
    const snapshot = await this.builds.where('projectId', '==', projectId).get();
    const items = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as BuildDocument) }));
    return items.sort((a, b) => this.toMillis(b.createdAt) - this.toMillis(a.createdAt));
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
    }

    await ref.update(update);
    const refreshed = await ref.get();
    return { id: buildId, ...(refreshed.data() as BuildDocument) };
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
}
