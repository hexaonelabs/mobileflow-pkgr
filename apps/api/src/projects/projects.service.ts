import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import { GithubService } from '../github/github.service';
import { FirestoreService } from '../firestore/firestore.service';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';
import { Framework, PROJECTS_COLLECTION, type ProjectDocument } from './project.model';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly githubService: GithubService,
  ) {}

  private get projects() {
    return this.firestore.db.collection(PROJECTS_COLLECTION);
  }

  async create(userId: string, dto: CreateProjectDto) {
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
}
