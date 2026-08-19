import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto flex max-w-3xl flex-col gap-6">
      @if (authService.currentUser(); as user) {
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-neutral-900">
            Welcome, {{ user.email }}
          </h1>
          <p class="mt-1 text-sm text-neutral-600">Here's an overview of your MobileFlow account.</p>
        </div>

        <div class="rounded-2xl border border-neutral-200 bg-white p-6">
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="text-sm font-semibold text-neutral-900">GitHub</p>
              <p class="mt-1 text-sm text-neutral-600">
                @if (user.githubInstallationId) {
                  Your GitHub account is connected. You can enable new repositories anytime.
                } @else {
                  Connect GitHub to enable repositories and launch your first builds.
                }
              </p>
            </div>
            <span
              class="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium"
              [class]="
                user.githubInstallationId
                  ? 'bg-green-50 text-green-700'
                  : 'bg-amber-50 text-amber-700'
              "
            >
              {{ user.githubInstallationId ? 'Connected' : 'Not connected' }}
            </span>
          </div>
          <a
            routerLink="/github/connect"
            class="mt-4 inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
          >
            {{ user.githubInstallationId ? 'Manage GitHub' : 'Connect GitHub' }}
          </a>
        </div>

        <div class="rounded-2xl border border-neutral-200 bg-white p-6">
          <p class="text-sm font-semibold text-neutral-900">Projets</p>
          <p class="mt-1 text-sm text-neutral-600">
            View your enabled repositories and build history.
          </p>
          <a
            routerLink="/projects"
            class="mt-4 inline-flex items-center gap-1 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
          >
            View my projects
          </a>
        </div>
      }
    </div>
  `,
})
export class Home {
  protected readonly authService = inject(AuthService);
}
