import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-billing-success',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-start gap-3">
      <h2 class="text-lg font-bold tracking-tight text-neutral-900">Subscription updated</h2>
      <p class="text-sm text-neutral-600">
        Your payment was processed. It may take a few seconds for your new plan to appear.
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
export class BillingSuccess {}
