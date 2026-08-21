import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { BillingService } from '../../core/billing/billing.service';
import type { SubscriptionSummary } from '../../core/billing/billing.models';

interface PlanCard {
  id: 'free' | 'starter';
  name: string;
  price: string;
  features: string[];
}

const PLAN_CARDS: PlanCard[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    features: ['Unlimited builds', 'Analytics (current month)', 'Email notifications (failed builds)'],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '$9/month',
    features: ['Everything in Free', 'Slack & Discord notifications', '30-day artifact archive'],
  },
];

@Component({
  selector: 'app-billing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <div>
        <h2 class="text-lg font-bold tracking-tight text-neutral-900">Billing</h2>
        <p class="mt-1 text-sm text-neutral-600">Manage your MobileFlow subscription.</p>
      </div>

      @if (errorMessage()) {
        <p role="alert" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {{ errorMessage() }}
        </p>
      }

      @if (subscription(); as sub) {
        <p class="text-sm text-neutral-600">
          Current plan: <span class="font-semibold text-neutral-900">{{ sub.plan }}</span>
          @if (sub.status === 'past_due') {
            <span class="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              Payment issue
            </span>
          }
        </p>
      }

      <div class="grid gap-4 sm:grid-cols-2">
        @for (plan of plans; track plan.id) {
          <section
            class="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-6"
            [class.border-accent-600]="subscription()?.plan === plan.id"
          >
            <div>
              <h3 class="text-sm font-semibold text-neutral-900">{{ plan.name }}</h3>
              <p class="mt-1 text-2xl font-bold text-neutral-900">{{ plan.price }}</p>
            </div>
            <ul class="flex flex-1 flex-col gap-2 text-sm text-neutral-600">
              @for (feature of plan.features; track feature) {
                <li class="flex items-start gap-2">
                  <span aria-hidden="true">✓</span>
                  {{ feature }}
                </li>
              }
            </ul>

            @if (subscription()?.plan === plan.id) {
              <span
                class="rounded-lg border border-neutral-300 px-4 py-2 text-center text-sm font-medium text-neutral-500"
              >
                Current plan
              </span>
            } @else if (plan.id === 'starter') {
              <button
                type="button"
                class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                [disabled]="checkoutLoading()"
                (click)="onUpgrade()"
              >
                {{ checkoutLoading() ? 'Redirecting…' : 'Upgrade to Starter' }}
              </button>
            }
          </section>
        }
      </div>

      @if (subscription()?.plan !== 'free') {
        <button
          type="button"
          class="w-fit rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
          [disabled]="portalLoading()"
          (click)="onManageSubscription()"
        >
          {{ portalLoading() ? 'Redirecting…' : 'Manage subscription' }}
        </button>
      }
    </div>
  `,
})
export class Billing implements OnInit {
  private readonly billingService = inject(BillingService);

  protected readonly plans = PLAN_CARDS;
  protected readonly subscription = signal<SubscriptionSummary | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly checkoutLoading = signal(false);
  protected readonly portalLoading = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const sub = await this.billingService.getSubscription();
      this.subscription.set(sub);
    } catch (err) {
      this.errorMessage.set(this.extractErrorMessage(err, 'Unable to load your subscription.'));
    }
  }

  protected async onUpgrade(): Promise<void> {
    this.errorMessage.set(null);
    this.checkoutLoading.set(true);
    try {
      const { url } = await this.billingService.createCheckoutSession('starter');
      window.location.href = url;
    } catch (err) {
      this.errorMessage.set(this.extractErrorMessage(err, 'Unable to start checkout.'));
      this.checkoutLoading.set(false);
    }
  }

  protected async onManageSubscription(): Promise<void> {
    this.errorMessage.set(null);
    this.portalLoading.set(true);
    try {
      const { url } = await this.billingService.createPortalSession();
      window.location.href = url;
    } catch (err) {
      this.errorMessage.set(this.extractErrorMessage(err, 'Unable to open the billing portal.'));
      this.portalLoading.set(false);
    }
  }

  private extractErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const message = (err.error as { message?: string } | undefined)?.message;
      if (message) return message;
    }
    return fallback;
  }
}
