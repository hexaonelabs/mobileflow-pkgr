import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { CheckoutSessionResult, PortalSessionResult, SubscriptionSummary } from './billing.models';

@Injectable({ providedIn: 'root' })
export class BillingService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/billing`;

  getSubscription(): Promise<SubscriptionSummary> {
    return firstValueFrom(this.http.get<SubscriptionSummary>(`${this.baseUrl}/subscription`));
  }

  createCheckoutSession(targetPlan: 'starter'): Promise<CheckoutSessionResult> {
    return firstValueFrom(
      this.http.post<CheckoutSessionResult>(`${this.baseUrl}/checkout`, { targetPlan }),
    );
  }

  createPortalSession(): Promise<PortalSessionResult> {
    return firstValueFrom(this.http.post<PortalSessionResult>(`${this.baseUrl}/portal`, {}));
  }
}
