import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import { GithubService } from '../github/github.service';
import { MOBILEFLOW_SETUP_WORKFLOW_FILENAME } from '../github/setup-workflow-template';
import { FirestoreService } from '../firestore/firestore.service';
import { QuotasService } from '../quotas/quotas.service';
import type { Plan } from '../users/user.model';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { TriggerSetupDto } from './dto/trigger-setup.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';
import { Framework, PROJECTS_COLLECTION, type ProjectDocument } from './project.model';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly githubService: GithubService,
    private readonly quotasService: QuotasService,
  ) {}

  private get projects() {
    return this.firestore.db.collection(PROJECTS_COLLECTION);
  }

  async getQuotaUsage(userId: string, plan: Plan): Promise<{ used: number; limit: number | null }> {
    const limit = await this.quotasService.getProjectsLimit(plan);
    const used = (await this.projects.where('userId', '==', userId).get()).size;
    return { used, limit };
  }

  async create(userId: string, plan: Plan, dto: CreateProjectDto) {
    const { used, limit } = await this.getQuotaUsage(userId, plan);
    if (limit !== null && used >= limit) {
      throw new ForbiddenException(
        `Limite de ${limit} projet(s) atteinte pour le plan ${plan}. Passez à un plan supérieur pour en activer plus.`,
      );
    }

    const repos = await this.githubService.listRepos(userId);
    const repo = repos.find((r) => r.fullName === dto.githubRepoFullName);
    if (!repo) {
      throw new BadRequestException(
        `Le dépôt "${dto.githubRepoFullName}" n'est pas accessible via votre installation GitHub.`,
      );
    }

    const existing = await this.projects
      .where('userId', '==', userId)
      .where('githubRepoFullName', '==', dto.githubRepoFullName)
      .limit(1)
      .get();
    if (!existing.empty) {
      throw new ConflictException('Ce dépôt est déjà activé sur un projet existant.');
    }

    const now = FieldValue.serverTimestamp();
    const doc: ProjectDocument = {
      userId,
      name: dto.name?.trim() || dto.githubRepoFullName.split('/')[1] || dto.githubRepoFullName,
      githubRepoFullName: dto.githubRepoFullName,
      framework: Framework.capacitor,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await this.projects.add(doc);
    return { id: ref.id, ...doc };
  }

  async findAllForUser(userId: string) {
    const snapshot = await this.projects.where('userId', '==', userId).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as ProjectDocument) }));
  }

  async findOneOwned(userId: string, id: string) {
    const doc = await this.projects.doc(id).get();
    const data = doc.data() as ProjectDocument | undefined;
    if (!doc.exists || !data || data.userId !== userId) {
      throw new NotFoundException('Projet introuvable.');
    }
    return { id: doc.id, ...data };
  }

  async update(userId: string, id: string, dto: UpdateProjectDto) {
    await this.findOneOwned(userId, id);
    await this.projects.doc(id).update({
      ...dto,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return this.findOneOwned(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.findOneOwned(userId, id);
    await this.projects.doc(id).delete();
  }

  async getReadiness(userId: string, id: string) {
    const project = await this.findOneOwned(userId, id);
    return this.githubService.getRepoReadiness(userId, project.githubRepoFullName);
  }

  async triggerSetup(userId: string, id: string, dto: TriggerSetupDto) {
    const project = await this.findOneOwned(userId, id);
    const readiness = await this.githubService.getRepoReadiness(userId, project.githubRepoFullName);
    if (
      readiness.capacitorInstalled &&
      readiness.androidPlatformAdded &&
      readiness.iosPlatformAdded
    ) {
      throw new BadRequestException('Ce dépôt est déjà prêt, aucune configuration nécessaire.');
    }

    const repos = await this.githubService.listRepos(userId);
    const repo = repos.find((r) => r.fullName === project.githubRepoFullName);
    if (!repo) {
      throw new BadRequestException(
        `Le dépôt "${project.githubRepoFullName}" n'est pas accessible via votre installation GitHub.`,
      );
    }
    const branch = repo.defaultBranch;

    await this.githubService.ensureSetupWorkflowInstalled(
      userId,
      project.githubRepoFullName,
      branch,
    );

    const setupId = `${id}-${Date.now()}`;
    const repoSlug =
      project.githubRepoFullName
        .split('/')[1]
        ?.toLowerCase()
        .replace(/[^a-z0-9]/g, '') || 'app';

    await this.githubService.dispatchWorkflowWithRetry(
      userId,
      project.githubRepoFullName,
      branch,
      MOBILEFLOW_SETUP_WORKFLOW_FILENAME,
      {
        setup_id: setupId,
        app_name: project.name,
        app_id: `io.mobileflow.${repoSlug}`,
        web_dir: dto.webDir,
        install_capacitor: String(!readiness.capacitorInstalled),
        add_android: String(!readiness.androidPlatformAdded),
        add_ios: String(!readiness.iosPlatformAdded),
      },
    );

    const runId = await this.githubService.correlateWorkflowRun(
      userId,
      project.githubRepoFullName,
      setupId,
    );

    return {
      runId,
      htmlUrl:
        runId !== null
          ? `https://github.com/${project.githubRepoFullName}/actions/runs/${runId}`
          : null,
    };
  }

  async resetBuildWorkflow(userId: string, id: string): Promise<void> {
    const project = await this.findOneOwned(userId, id);
    const repos = await this.githubService.listRepos(userId);
    const repo = repos.find((r) => r.fullName === project.githubRepoFullName);
    if (!repo) {
      throw new BadRequestException(
        `Le dépôt "${project.githubRepoFullName}" n'est pas accessible via votre installation GitHub.`,
      );
    }
    await this.githubService.resetBuildWorkflowToDefault(
      userId,
      project.githubRepoFullName,
      repo.defaultBranch,
    );
  }
}
