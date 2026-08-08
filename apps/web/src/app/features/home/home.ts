import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4">
      <h1 class="text-2xl font-semibold">MobileFlow</h1>
      @if (authService.currentUser(); as user) {
        <p>Connecté en tant que {{ user.email }}.</p>
        @if (user.githubInstallationId) {
          <p>GitHub connecté.</p>
        }
        <a class="rounded border border-gray-400 px-4 py-2 text-center" routerLink="/github/connect">
          @if (user.githubInstallationId) {
            Gérer GitHub
          } @else {
            Connecter GitHub
          }
        </a>
      }
      <button type="button" class="rounded border border-gray-400 px-4 py-2" (click)="logout()">
        Se déconnecter
      </button>
    </main>
  `,
})
export class Home {
  protected readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected async logout(): Promise<void> {
    this.authService.logout();
    await this.router.navigateByUrl('/auth/login');
  }
}
