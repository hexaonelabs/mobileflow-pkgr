import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AnalyticsChartsComponent } from './analytics-charts';
import { AnalyticsSummaryComponent } from './analytics-summary';

@Component({
  selector: 'app-analytics',
  imports: [AnalyticsSummaryComponent, AnalyticsChartsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <div>
        <h2 class="text-lg font-bold tracking-tight text-neutral-900">Analytics</h2>
        <p class="mt-1 text-sm text-neutral-600">Build activity for the current month.</p>
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

  protected readonly projectId = signal('');
  protected readonly errorMessage = signal<string | null>(null);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.errorMessage.set('Project not found.');
      return;
    }
    this.projectId.set(id);
  }
}
