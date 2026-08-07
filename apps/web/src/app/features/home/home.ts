import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4">
      <h1 class="text-2xl font-semibold">MobileFlow</h1>
      @if (authService.currentUser(); as user) {
        <p>Connecté en tant que {{ user.email }}.</p>
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
