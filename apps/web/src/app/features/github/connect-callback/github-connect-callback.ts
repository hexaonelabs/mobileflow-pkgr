import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { GithubService } from '../../../core/github/github.service';

@Component({
  selector: 'app-github-connect-callback',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-4">
      <p role="status">{{ statusMessage() }}</p>
    </main>
  `,
})
export class GithubConnectCallback implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly githubService = inject(GithubService);

  protected readonly statusMessage = signal('Connexion à GitHub en cours…');

  async ngOnInit(): Promise<void> {
    const params = this.route.snapshot.queryParamMap;
    const installationId = params.get('installation_id');
    const setupAction = params.get('setup_action');

    if (setupAction === 'request') {
      this.statusMessage.set(
        "Installation en attente d'approbation par un administrateur de l'organisation GitHub.",
      );
      return;
    }

    if (!installationId) {
      this.statusMessage.set('Connexion GitHub impossible : installation_id manquant.');
      return;
    }

    try {
      await this.githubService.completeInstallation(installationId);
      await this.authService.refreshUser();
      await this.router.navigateByUrl('/');
    } catch {
      this.statusMessage.set('Connexion GitHub impossible.');
    }
  }
}
