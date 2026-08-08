import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { GithubService } from '../../../core/github/github.service';
import type { GithubRepo, GithubRequestedPermission } from '../../../core/github/github.models';

@Component({
  selector: 'app-github-connect',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-8">
      <h1 class="text-2xl font-semibold">Connecter GitHub</h1>

      @if (isConnected()) {
        <p>GitHub est connecté à votre compte MobileFlow.</p>

        @if (reposError()) {
          <p role="alert">{{ reposError() }}</p>
        } @else if (repos(); as list) {
          @if (list.length === 0) {
            <p>Aucun dépôt accessible pour le moment.</p>
          } @else {
            <ul class="flex flex-col gap-2 rounded border border-gray-300 p-4">
              @for (repo of list; track repo.fullName) {
                <li class="flex items-center justify-between gap-2">
                  <span>{{ repo.fullName }}</span>
                  @if (repo.private) {
                    <span class="text-xs text-gray-500">Privé</span>
                  }
                </li>
              }
            </ul>
          }
        } @else {
          <p role="status">Chargement des dépôts connectés…</p>
        }

        <a
          class="rounded border border-gray-400 px-4 py-2 text-center"
          [attr.href]="installUrl()"
          [attr.aria-disabled]="!installUrl()"
        >
          Connecter d'autres dépôts
        </a>
      } @else {
        <p>
          MobileFlow a besoin d'installer une GitHub App sur les dépôts que vous souhaitez
          builder. Les permissions suivantes seront demandées lors de l'installation :
        </p>

        @if (permissions(); as list) {
          <ul class="flex flex-col gap-2 rounded border border-gray-300 p-4">
            @for (permission of list; track permission.scope) {
              <li>
                <span class="font-mono text-sm">{{ permission.scope }}</span>
                — {{ permission.label }}
              </li>
            }
          </ul>
        } @else if (errorMessage()) {
          <p role="alert">{{ errorMessage() }}</p>
        } @else {
          <p role="status">Chargement des permissions…</p>
        }

        <button
          type="button"
          class="rounded border border-gray-400 px-4 py-2 disabled:opacity-50"
          [disabled]="!installUrl()"
          (click)="connect()"
        >
          Connecter GitHub
        </button>
      }
    </main>
  `,
})
export class GithubConnect implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly githubService = inject(GithubService);

  protected readonly isConnected = computed(
    () => this.authService.currentUser()?.githubInstallationId != null,
  );

  protected readonly permissions = signal<GithubRequestedPermission[] | null>(null);
  protected readonly installUrl = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly repos = signal<GithubRepo[] | null>(null);
  protected readonly reposError = signal<string | null>(null);

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
        this.repos.set(await this.githubService.listRepos());
      } catch {
        this.reposError.set('Impossible de charger la liste des dépôts.');
      }
    }
  }

  protected connect(): void {
    const url = this.installUrl();
    if (url) {
      window.location.href = url;
    }
  }
}
