import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-billing-cancel',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-start gap-3">
      <h2 class="text-lg font-bold tracking-tight text-neutral-900">Checkout canceled</h2>
      <p class="text-sm text-neutral-600">No changes were made to your subscription.</p>
      <a
        routerLink="/billing"
        class="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
      >
        Back to billing
      </a>
    </div>
  `,
})
export class BillingCancel {}
