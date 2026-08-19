import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FieldValue } from 'firebase-admin/firestore';
import type { App as OctokitApp } from 'octokit';
import { FirestoreService } from '../firestore/firestore.service';
import { USERS_COLLECTION, type UserDocument } from '../users/user.model';
import { MOBILEFLOW_SETUP_WORKFLOW_PATH, buildSetupWorkflowYaml } from './setup-workflow-template';
import { MOBILEFLOW_WORKFLOW_PATH, buildWorkflowYaml } from './workflow-template';

const RUN_DISPATCH_ATTEMPTS = 5;
const RUN_DISPATCH_RETRY_DELAY_MS = 1500;

export interface WorkflowRunStatus {
  status: string | null;
  conclusion: string | null;
  htmlUrl: string;
  startedAt: string | null;
  updatedAt: string;
}

export interface RepoReadiness {
  hasPackageJson: boolean;
  capacitorInstalled: boolean;
  androidPlatformAdded: boolean;
  iosPlatformAdded: boolean;
}

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

  // Lecture seule : n'exécute rien, se contente d'inspecter package.json et la présence des
  // dossiers natifs générés par `npx cap add` pour dire à l'utilisateur ce qu'il lui manque.
  async getRepoReadiness(userId: string, repoFullName: string): Promise<RepoReadiness> {
    const { owner, repo } = this.splitRepo(repoFullName);
    const octokit = await this.getInstallationOctokit(userId);
    try {
      const packageJson = await this.tryGetJsonFile(octokit, owner, repo, 'package.json');
      const deps = {
        ...(packageJson?.dependencies as Record<string, string> | undefined),
        ...(packageJson?.devDependencies as Record<string, string> | undefined),
      };
      const [androidPlatformAdded, iosPlatformAdded] = await Promise.all([
        this.pathExists(octokit, owner, repo, 'android/app/build.gradle'),
        this.pathExists(octokit, owner, repo, 'ios/App/Podfile'),
      ]);
      return {
        hasPackageJson: packageJson !== null,
        capacitorInstalled: '@capacitor/core' in deps,
        androidPlatformAdded,
        iosPlatformAdded,
      };
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  private async tryGetJsonFile(
    octokit: Awaited<ReturnType<GithubService['getInstallationOctokit']>>,
    owner: string,
    repo: string,
    path: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
      if (Array.isArray(data) || data.type !== 'file') {
        return null;
      }
      return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')) as Record<
        string,
        unknown
      >;
    } catch (error) {
      if ((error as { status?: number } | null)?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  private async pathExists(
    octokit: Awaited<ReturnType<GithubService['getInstallationOctokit']>>,
    owner: string,
    repo: string,
    path: string,
  ): Promise<boolean> {
    try {
      await octokit.rest.repos.getContent({ owner, repo, path });
      return true;
    } catch (error) {
      if ((error as { status?: number } | null)?.status === 404) {
        return false;
      }
      throw error;
    }
  }

  // N'installe le fichier que s'il est absent — une fois présent, MobileFlow n'y touche plus
  // jamais automatiquement, pour que l'utilisateur puisse le personnaliser sans risquer de se
  // le faire écraser au build suivant (cf. resetWorkflowToDefault pour revenir au template).
  // GitHub exige que le fichier existe sur la branche ciblée par workflow_dispatch elle-même
  // (pas seulement sur la branche par défaut), donc on l'installe branche par branche à la demande.
  async ensureWorkflowInstalled(
    userId: string,
    repoFullName: string,
    branch: string,
  ): Promise<void> {
    await this.pushWorkflowFileIfMissing(
      userId,
      repoFullName,
      branch,
      MOBILEFLOW_WORKFLOW_PATH,
      buildWorkflowYaml(),
      'MobileFlow build workflow',
    );
  }

  async ensureSetupWorkflowInstalled(
    userId: string,
    repoFullName: string,
    branch: string,
  ): Promise<void> {
    await this.pushWorkflowFileIfMissing(
      userId,
      repoFullName,
      branch,
      MOBILEFLOW_SETUP_WORKFLOW_PATH,
      buildSetupWorkflowYaml(),
      'MobileFlow setup workflow',
    );
  }

  // Action explicite et destructive (écrase toute personnalisation) : réservée à un bouton
  // dédié où l'utilisateur confirme vouloir revenir au template MobileFlow par défaut.
  async resetBuildWorkflowToDefault(
    userId: string,
    repoFullName: string,
    branch: string,
  ): Promise<void> {
    await this.forcePushWorkflowFile(
      userId,
      repoFullName,
      branch,
      MOBILEFLOW_WORKFLOW_PATH,
      buildWorkflowYaml(),
      'MobileFlow build workflow',
    );
  }

  private async pushWorkflowFileIfMissing(
    userId: string,
    repoFullName: string,
    branch: string,
    path: string,
    content: string,
    label: string,
  ): Promise<void> {
    const { owner, repo } = this.splitRepo(repoFullName);
    const octokit = await this.getInstallationOctokit(userId);
    try {
      try {
        await octokit.rest.repos.getContent({ owner, repo, path, ref: branch });
        return;
      } catch (error) {
        if ((error as { status?: number } | null)?.status !== 404) {
          throw error;
        }
      }
      await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        branch,
        message: `chore: install ${label}`,
        content: Buffer.from(content, 'utf8').toString('base64'),
      });
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  private async forcePushWorkflowFile(
    userId: string,
    repoFullName: string,
    branch: string,
    path: string,
    content: string,
    label: string,
  ): Promise<void> {
    const { owner, repo } = this.splitRepo(repoFullName);
    const octokit = await this.getInstallationOctokit(userId);
    try {
      let sha: string | undefined;
      try {
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref: branch });
        if (!Array.isArray(data) && data.type === 'file') {
          sha = data.sha;
        }
      } catch (error) {
        if ((error as { status?: number } | null)?.status !== 404) {
          throw error;
        }
      }
      await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        branch,
        message: `chore: reset ${label} to default`,
        content: Buffer.from(content, 'utf8').toString('base64'),
        sha,
      });
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async dispatchWorkflow(
    userId: string,
    repoFullName: string,
    branch: string,
    workflowFilename: string,
    inputs: Record<string, string>,
  ): Promise<void> {
    const { owner, repo } = this.splitRepo(repoFullName);
    const octokit = await this.getInstallationOctokit(userId);
    try {
      await octokit.rest.actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id: workflowFilename,
        ref: branch,
        inputs,
      });
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  // Juste après la création/mise à jour d'un fichier workflow, GitHub met parfois quelques
  // secondes à l'indexer : workflow_dispatch peut répondre 404 pendant cette fenêtre.
  async dispatchWorkflowWithRetry(
    userId: string,
    repoFullName: string,
    branch: string,
    workflowFilename: string,
    inputs: Record<string, string>,
  ): Promise<void> {
    for (let attempt = 0; attempt < RUN_DISPATCH_ATTEMPTS; attempt++) {
      try {
        await this.dispatchWorkflow(userId, repoFullName, branch, workflowFilename, inputs);
        return;
      } catch (error) {
        const isLastAttempt = attempt === RUN_DISPATCH_ATTEMPTS - 1;
        if (!(error instanceof NotFoundException) || isLastAttempt) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, RUN_DISPATCH_RETRY_DELAY_MS));
      }
    }
  }

  // GitHub ne renvoie pas l'ID du run au moment du dispatch : on retente la corrélation
  // quelques secondes, le temps que GitHub enregistre le run déclenché.
  async correlateWorkflowRun(
    userId: string,
    repoFullName: string,
    runLabel: string,
  ): Promise<number | null> {
    for (let attempt = 0; attempt < RUN_DISPATCH_ATTEMPTS; attempt++) {
      const runId = await this.findWorkflowRunId(userId, repoFullName, runLabel);
      if (runId !== null) {
        return runId;
      }
      await new Promise((resolve) => setTimeout(resolve, RUN_DISPATCH_RETRY_DELAY_MS));
    }
    return null;
  }

  // GitHub ne renvoie pas l'ID du run au moment du dispatch : on le retrouve en listant les
  // runs récents et en cherchant le run-name (templaté avec build_id dans le workflow).
  async findWorkflowRunId(
    userId: string,
    repoFullName: string,
    buildId: string,
  ): Promise<number | null> {
    const { owner, repo } = this.splitRepo(repoFullName);
    const octokit = await this.getInstallationOctokit(userId);
    try {
      const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        event: 'workflow_dispatch',
        per_page: 20,
      });
      const match = data.workflow_runs.find((run) => run.name?.includes(buildId));
      return match?.id ?? null;
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  async getWorkflowRun(
    userId: string,
    repoFullName: string,
    runId: number,
  ): Promise<WorkflowRunStatus> {
    const { owner, repo } = this.splitRepo(repoFullName);
    const octokit = await this.getInstallationOctokit(userId);
    try {
      const { data } = await octokit.rest.actions.getWorkflowRun({ owner, repo, run_id: runId });
      return {
        status: data.status,
        conclusion: data.conclusion,
        htmlUrl: data.html_url,
        startedAt: data.run_started_at ?? null,
        updatedAt: data.updated_at,
      };
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  // Le téléchargement direct de l'API GitHub (archive_download_url) redirige vers une URL
  // signée valable ~1 minute, donc inutilisable comme lien stocké en base. La page artefact
  // sur github.com est en revanche une URL stable (avec bouton "Download") tant que l'artefact
  // n'a pas expiré (rétention par défaut : 90 jours).
  async findArtifactUrl(
    userId: string,
    repoFullName: string,
    runId: number,
    artifactName: string,
  ): Promise<string | null> {
    const { owner, repo } = this.splitRepo(repoFullName);
    const octokit = await this.getInstallationOctokit(userId);
    try {
      const artifact = await this.findArtifact(octokit, owner, repo, runId, artifactName);
      if (!artifact) {
        return null;
      }
      return `https://github.com/${owner}/${repo}/actions/runs/${runId}/artifacts/${artifact.id}`;
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  // Télécharge le contenu brut (zip) d'un artefact de run — utilisé à la demande (clic sur
  // "Installer") pour en extraire le binaire buildé et l'héberger sur Firebase Storage, plutôt
  // que d'héberger systématiquement chaque build (coût de stockage).
  async downloadRunArtifactZip(
    userId: string,
    repoFullName: string,
    runId: number,
    artifactName: string,
  ): Promise<Buffer> {
    const { owner, repo } = this.splitRepo(repoFullName);
    const octokit = await this.getInstallationOctokit(userId);
    try {
      const artifact = await this.findArtifact(octokit, owner, repo, runId, artifactName);
      if (!artifact) {
        throw new NotFoundException('Artefact GitHub introuvable ou expiré.');
      }
      const response = await octokit.rest.actions.downloadArtifact({
        owner,
        repo,
        artifact_id: artifact.id,
        archive_format: 'zip',
      });
      return Buffer.from(response.data as ArrayBuffer);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw this.toHttpException(error);
    }
  }

  private async findArtifact(
    octokit: Awaited<ReturnType<GithubService['getInstallationOctokit']>>,
    owner: string,
    repo: string,
    runId: number,
    artifactName: string,
  ): Promise<{ id: number } | null> {
    const { data } = await octokit.rest.actions.listWorkflowRunArtifacts({
      owner,
      repo,
      run_id: runId,
      per_page: 100,
    });
    const artifact = data.artifacts.find((item) => item.name === artifactName && !item.expired);
    return artifact ? { id: artifact.id } : null;
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
