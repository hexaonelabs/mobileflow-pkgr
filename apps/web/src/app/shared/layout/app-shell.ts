import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Logo } from '../ui/logo';

const NAV_LINK_CLASS =
  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600';
const NAV_LINK_ACTIVE_CLASS = 'bg-accent-50 text-accent-700 hover:bg-accent-50 hover:text-accent-700';

@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-dvh flex-col bg-neutral-50 md:flex-row">
      <header
        class="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 md:hidden"
      >
        <a routerLink="/projects" class="flex items-center gap-2">
          <app-logo class="h-6 w-6" />
          <span class="text-base font-bold tracking-tight text-neutral-900">MobileFlow</span>
        </a>
        <button
          type="button"
          class="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
          (click)="logout()"
        >
          Logout
        </button>
      </header>

      <aside class="hidden w-64 shrink-0 flex-col border-r border-neutral-200 bg-white md:flex">
        <div class="flex items-center gap-2 border-b border-neutral-200 px-5 py-4">
          <app-logo class="h-7 w-7" />
          <span class="text-base font-bold tracking-tight text-neutral-900">MobileFlow</span>
        </div>

        <nav aria-label="Main navigation" class="flex flex-1 flex-col gap-1 px-3 py-4">
          <a routerLink="/projects" routerLinkActive="${NAV_LINK_ACTIVE_CLASS}" class="${NAV_LINK_CLASS}">
            <svg aria-hidden="true" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 7.5L12 12l8-4.5M12 12v9" />
            </svg>
            Apps
          </a>
          <a routerLink="/github/connect" routerLinkActive="${NAV_LINK_ACTIVE_CLASS}" class="${NAV_LINK_CLASS}">
            <svg aria-hidden="true" class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path
                fill-rule="evenodd"
                clip-rule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.833.092-.647.35-1.088.636-1.338-2.221-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.31.678.921.678 1.856 0 1.339-.012 2.419-.012 2.749 0 .268.18.58.688.482A10.02 10.02 0 0022 12.017C22 6.484 17.522 2 12 2z"
              />
            </svg>
            GitHub
          </a>
        </nav>

        <div class="border-t border-neutral-200 p-3">
          @if (authService.currentUser(); as user) {
            <p class="truncate px-2 text-xs text-neutral-500">{{ user.email }}</p>
          }
          <button
            type="button"
            class="mt-2 w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
            (click)="logout()"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main class="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <router-outlet />
      </main>
    </div>
  `,
})
export class AppShell {
  protected readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected async logout(): Promise<void> {
    this.authService.logout();
    await this.router.navigateByUrl('/auth/login');
  }
}
