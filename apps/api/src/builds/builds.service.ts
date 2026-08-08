import { Injectable, NotFoundException } from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import { GithubService } from '../github/github.service';
import { FirestoreService } from '../firestore/firestore.service';
import { PROJECTS_COLLECTION, type ProjectDocument } from '../projects/project.model';
import { BUILDS_COLLECTION, BuildStatus, TriggeredBy, type BuildDocument } from './build.model';
import type { CreateBuildDto } from './dto/create-build.dto';

@Injectable()
export class BuildsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly githubService: GithubService,
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

    const now = FieldValue.serverTimestamp();
    const created = await Promise.all(
      dto.platforms.map(async (platform) => {
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
        return { id: ref.id, ...doc };
      }),
    );
    return created;
  }

  async findAllForProject(userId: string, projectId: string) {
    await this.getOwnedProject(userId, projectId);
    const snapshot = await this.builds.where('projectId', '==', projectId).get();
    const items = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as BuildDocument) }));
    return items.sort((a, b) => this.toMillis(b.createdAt) - this.toMillis(a.createdAt));
  }

  private toMillis(value: BuildDocument['createdAt']): number {
    return typeof value === 'object' && value !== null && 'toMillis' in value
      ? value.toMillis()
      : 0;
  }
}
