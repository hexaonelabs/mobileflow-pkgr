import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FieldValue } from 'firebase-admin/firestore';
import type { App as OctokitApp } from 'octokit';
import { FirestoreService } from '../firestore/firestore.service';
import { USERS_COLLECTION, type UserDocument } from '../users/user.model';

export const GITHUB_APP_REQUESTED_PERMISSIONS = [
  { scope: 'contents:write', label: 'Contenu du dépôt (lecture/écriture)' },
  { scope: 'actions:write', label: 'GitHub Actions (déclenchement des workflows)' },
  { scope: 'actions:read', label: 'GitHub Actions (lecture des runs et du quota)' },
] as const;

@Injectable()
export class GithubService {
  private appPromise: Promise<OctokitApp> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly firestore: FirestoreService,
  ) {}

  private get users() {
    return this.firestore.db.collection(USERS_COLLECTION);
  }

  getInstallUrl(): string {
    const slug = this.configService.getOrThrow<string>('GITHUB_APP_SLUG');
    return `https://github.com/apps/${slug}/installations/new`;
  }

  async connectInstallation(userId: string, installationId: string): Promise<void> {
    await this.users.doc(userId).update({
      githubInstallationId: installationId,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async listRepos(userId: string) {
    const octokit = await this.getInstallationOctokit(userId);
    try {
      const { data } = await octokit.rest.apps.listReposAccessibleToInstallation();
      return (data.repositories ?? []).map((repo) => ({
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
        private: repo.private,
      }));
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async listBranches(userId: string, repoFullName: string) {
    const { owner, repo } = this.splitRepo(repoFullName);
    const octokit = await this.getInstallationOctokit(userId);
    try {
      const { data } = await octokit.rest.repos.listBranches({ owner, repo, per_page: 100 });
      return data.map((branch) => branch.name);
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async getBranchHeadSha(userId: string, repoFullName: string, branch: string): Promise<string> {
    const { owner, repo } = this.splitRepo(repoFullName);
    const octokit = await this.getInstallationOctokit(userId);
    try {
      const { data } = await octokit.rest.repos.getBranch({ owner, repo, branch });
      return data.commit.sha;
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  private toHttpException(error: unknown): Error {
    const status = (error as { status?: number } | null)?.status;
    if (status === 404) {
      return new NotFoundException(
        "Installation GitHub introuvable ou dépôt inaccessible — l'installation a peut-être été révoquée côté GitHub.",
      );
    }
    return new BadRequestException("Erreur lors de l'appel à l'API GitHub.");
  }

  /**
   * L'API de quota Actions (billing) nécessite des permissions non accessibles
   * via un token d'installation GitHub App pour un compte personnel — best-effort,
   * dégrade proprement si indisponible (cf. tasks.md Phase 2, point ouvert).
   */
  async getActionsQuota(userId: string, repoFullName: string) {
    const { owner, repo } = this.splitRepo(repoFullName);
    const octokit = await this.getInstallationOctokit(userId);
    try {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/actions/cache/usage', {
        owner,
        repo,
      });
      return { available: true, ...data };
    } catch {
      return { available: false as const };
    }
  }

  private splitRepo(repoFullName: string): { owner: string; repo: string } {
    const [owner, repo] = repoFullName.split('/');
    if (!owner || !repo) {
      throw new BadRequestException('Format de repo invalide, attendu "owner/repo".');
    }
    return { owner, repo };
  }

  private async getInstallationOctokit(userId: string) {
    const doc = await this.users.doc(userId).get();
    const data = doc.data() as UserDocument | undefined;
    if (!data?.githubInstallationId) {
      throw new BadRequestException(
        'Aucune installation GitHub App connectée pour cet utilisateur.',
      );
    }
    const app = await this.getApp();
    return app.getInstallationOctokit(Number(data.githubInstallationId));
  }

  private async getApp(): Promise<OctokitApp> {
    if (!this.appPromise) {
      this.appPromise = import('octokit').then(
        ({ App }) =>
          new App({
            appId: this.configService.getOrThrow<string>('GITHUB_APP_ID'),
            privateKey: this.configService
              .getOrThrow<string>('GITHUB_APP_PRIVATE_KEY')
              .replace(/\\n/g, '\n'),
          }),
      );
    }
    return this.appPromise;
  }
}
