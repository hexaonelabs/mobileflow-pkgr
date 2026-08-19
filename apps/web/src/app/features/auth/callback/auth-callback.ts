import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { Logo } from '../../../shared/ui/logo';

@Component({
  selector: 'app-auth-callback',
  imports: [Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <app-logo class="h-9 w-9" />
      <p role="status" class="text-sm text-neutral-600">
        {{ errorMessage() ?? 'Connexion en cours…' }}
      </p>
    </main>
  `,
})
export class AuthCallback implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);

  protected readonly errorMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.errorMessage.set('Connexion impossible : jeton manquant.');
      return;
    }
    try {
      await this.authService.completeOAuthSession(token);
      await this.router.navigateByUrl('/');
    } catch {
      this.errorMessage.set('Connexion impossible.');
    }
  }
}
