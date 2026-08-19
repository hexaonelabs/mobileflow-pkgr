import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { GithubService } from '../../../core/github/github.service';
import { Logo } from '../../../shared/ui/logo';

@Component({
  selector: 'app-github-connect-callback',
  imports: [Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <app-logo class="h-9 w-9" />
      <p role="status" class="text-sm text-neutral-600">{{ statusMessage() }}</p>
    </main>
  `,
})
export class GithubConnectCallback implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly githubService = inject(GithubService);

  protected readonly statusMessage = signal('Connecting to GitHub…');

  async ngOnInit(): Promise<void> {
    const params = this.route.snapshot.queryParamMap;
    const installationId = params.get('installation_id');
    const setupAction = params.get('setup_action');

    if (setupAction === 'request') {
      this.statusMessage.set(
        "Installation awaiting approval by a GitHub organization administrator.",
      );
      return;
    }

    if (!installationId) {
      this.statusMessage.set('GitHub connection failed: installation_id missing.');
      return;
    }

    try {
      await this.githubService.completeInstallation(installationId);
      await this.authService.refreshUser();
      await this.router.navigateByUrl('/');
    } catch {
      this.statusMessage.set('GitHub connection failed.');
    }
  }
}
