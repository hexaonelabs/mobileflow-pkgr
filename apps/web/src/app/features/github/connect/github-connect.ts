import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { GithubService } from '../../../core/github/github.service';
import type { GithubRepo, GithubRequestedPermission } from '../../../core/github/github.models';
import { ProjectsService } from '../../../core/projects/projects.service';
import type { Project } from '../../../core/projects/project.models';

@Component({
  selector: 'app-github-connect',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 class="text-2xl font-bold tracking-tight text-neutral-900">GitHub</h1>

      @if (isConnected()) {
        <div class="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
          <div class="border-b border-neutral-200 px-5 py-4">
            <p class="text-sm font-semibold text-neutral-900">Accessible Repositories</p>
            <p class="text-xs text-neutral-500">Enable a repository to start building.</p>
          </div>

          @if (reposError()) {
            <p role="alert" class="px-5 py-4 text-sm text-red-600">{{ reposError() }}</p>
          } @else if (repos(); as list) {
            @if (list.length === 0) {
              <p class="px-5 py-8 text-center text-sm text-neutral-600">
                No accessible repositories yet.
              </p>
            } @else {
              <ul class="divide-y divide-neutral-100">
                @for (repo of list; track repo.fullName) {
                  <li class="flex items-center justify-between gap-4 px-5 py-3">
                    <span class="truncate text-sm font-medium text-neutral-900">{{
                      repo.fullName
                    }}</span>
                    @if (projectIdByRepo().has(repo.fullName)) {
                      <a
                        class="shrink-0 rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                        [routerLink]="['/projects', projectIdByRepo().get(repo.fullName)]"
                      >
                        Active
                      </a>
                    } @else {
                      <button
                        type="button"
                        class="shrink-0 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                        [disabled]="activating() === repo.fullName"
                        (click)="activate(repo)"
                      >
                        {{ activating() === repo.fullName ? 'Activating…' : 'Enable' }}
                      </button>
                    }
                  </li>
                }
              </ul>
            }
          } @else {
            <p role="status" class="px-5 py-8 text-center text-sm text-neutral-500">
              Loading connected repositories…
            </p>
          }
        </div>

        <a
          class="inline-flex w-fit items-center gap-1.5 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
          [attr.href]="installUrl()"
          [attr.aria-disabled]="!installUrl()"
        >
          Connect more repositories
        </a>
      } @else {
        <div class="rounded-2xl border border-neutral-200 bg-white p-6">
          <p class="text-sm text-neutral-600">
            MobileFlow needs to install a GitHub App on the repositories you want to build.
            The following permissions will be requested during installation:
          </p>

          @if (permissions(); as list) {
            <ul class="mt-4 divide-y divide-neutral-100 rounded-xl border border-neutral-200">
              @for (permission of list; track permission.scope) {
                <li class="px-4 py-3 text-sm">
                  <span class="font-mono text-xs text-neutral-500">{{ permission.scope }}</span>
                  <span class="ml-2 text-neutral-700">{{ permission.label }}</span>
                </li>
              }
            </ul>
          } @else if (errorMessage()) {
            <p role="alert" class="mt-4 text-sm text-red-600">{{ errorMessage() }}</p>
          } @else {
            <p role="status" class="mt-4 text-sm text-neutral-500">Loading permissions…</p>
          }

          <button
            type="button"
            class="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
            [disabled]="!installUrl()"
            (click)="connect()"
          >
            Connecter GitHub
          </button>
        </div>
      }
    </div>
  `,
})
export class GithubConnect implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly githubService = inject(GithubService);
  private readonly projectsService = inject(ProjectsService);

  protected readonly isConnected = computed(
    () => this.authService.currentUser()?.githubInstallationId != null,
  );

  protected readonly permissions = signal<GithubRequestedPermission[] | null>(null);
  protected readonly installUrl = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly repos = signal<GithubRepo[] | null>(null);
  protected readonly reposError = signal<string | null>(null);
  protected readonly projects = signal<Project[]>([]);
  protected readonly activating = signal<string | null>(null);

  protected readonly projectIdByRepo = computed(
    () => new Map(this.projects().map((project) => [project.githubRepoFullName, project.id])),
  );

  async ngOnInit(): Promise<void> {
    try {
      const { url, requestedPermissions } = await this.githubService.getInstallUrl();
      this.installUrl.set(url);
      this.permissions.set(requestedPermissions);
    } catch {
      this.errorMessage.set("Impossible de charger les informations d'installation GitHub.");
    }

    if (this.isConnected()) {
      try {
        const [repos, projects] = await Promise.all([
          this.githubService.listRepos(),
          this.projectsService.list(),
        ]);
        this.repos.set(repos);
        this.projects.set(projects);
      } catch {
        this.reposError.set('Unable to load repository list.');
      }
    }
  }

  protected connect(): void {
    const url = this.installUrl();
    if (url) {
      window.location.href = url;
    }
  }

  protected async activate(repo: GithubRepo): Promise<void> {
    this.activating.set(repo.fullName);
    try {
      const project = await this.projectsService.create({ githubRepoFullName: repo.fullName });
      this.projects.update((list) => [...list, project]);
    } catch {
      this.reposError.set(`Impossible d'activer ${repo.fullName}.`);
    } finally {
      this.activating.set(null);
    }
  }
}
