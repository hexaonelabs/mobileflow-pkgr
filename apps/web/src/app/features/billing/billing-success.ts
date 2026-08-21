import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 5;

@Component({
  selector: 'app-billing-success',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-start gap-3">
      <h2 class="text-lg font-bold tracking-tight text-neutral-900">Subscription updated</h2>
      <p class="text-sm text-neutral-600">
        @if (refreshing()) {
          Your payment was processed. Confirming your new plan…
        } @else {
          Your payment was processed and your new plan is now active.
        }
      </p>
      <a
        routerLink="/billing"
        class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
      >
        Back to billing
      </a>
    </div>
  `,
})
export class BillingSuccess implements OnInit {
  private readonly authService = inject(AuthService);

  protected readonly refreshing = signal(true);

  // Le webhook Stripe qui persiste le nouveau plan est asynchrone : au moment où l'utilisateur
  // atterrit sur cette page après le checkout, il n'a pas forcément encore été traité.
  async ngOnInit(): Promise<void> {
    const planBeforeCheckout = this.authService.currentUser()?.plan;
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await this.authService.refreshUser();
      if (this.authService.currentUser()?.plan !== planBeforeCheckout) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    this.refreshing.set(false);
  }
}
