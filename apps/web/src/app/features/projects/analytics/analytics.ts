import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { AnalyticsChartsComponent } from './analytics-charts';
import { AnalyticsSummaryComponent } from './analytics-summary';

@Component({
  selector: 'app-analytics',
  imports: [AnalyticsSummaryComponent, AnalyticsChartsComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <div>
        <h2 class="text-lg font-bold tracking-tight text-neutral-900">Analytics</h2>
        @if (isFreePlan()) {
          <p class="mt-1 text-sm text-amber-700" role="status">
            Showing the current month only.
            <a routerLink="/billing" class="font-medium underline hover:text-amber-800">
              Upgrade to Starter
            </a>
            to see your full build history.
          </p>
        } @else {
          <p class="mt-1 text-sm text-neutral-600">Showing your full build history.</p>
        }
      </div>

      @if (errorMessage()) {
        <p role="alert" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {{ errorMessage() }}
        </p>
      } @else if (projectId(); as id) {
        <app-analytics-summary [projectId]="id" />
        <app-analytics-charts [projectId]="id" />
      }
    </div>
  `,
})
export class Analytics implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly authService = inject(AuthService);

  protected readonly projectId = signal('');
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly isFreePlan = computed(() => this.authService.currentUser()?.plan === 'free');

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.errorMessage.set('Project not found.');
      return;
    }
    this.projectId.set(id);
  }
}
