import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { ProjectsService } from '../../../core/projects/projects.service';
import type { AnalyticsSummary, Environment, Platform } from '../../../core/projects/project.models';

const PLATFORMS: Platform[] = ['ios', 'android'];
const ENVIRONMENTS: Environment[] = ['staging', 'production'];

const PLATFORM_LABELS: Record<Platform, string> = {
  ios: 'iOS',
  android: 'Android',
};

const ENVIRONMENT_LABELS: Record<Environment, string> = {
  staging: 'Staging',
  production: 'Production',
};

@Component({
  selector: 'app-analytics-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (errorMessage()) {
      <p role="alert" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {{ errorMessage() }}
      </p>
    } @else if (summary(); as summary) {
      <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div class="rounded-2xl border border-neutral-200 bg-white p-5">
          <p class="text-sm text-neutral-500">Total Builds</p>
          <p class="mt-1 text-2xl font-bold text-neutral-900">{{ summary.totalBuilds }}</p>
        </div>

        <div class="rounded-2xl border border-neutral-200 bg-white p-5">
          <p class="text-sm text-neutral-500">Success Rate</p>
          <p
            class="mt-1 text-2xl font-bold"
            [class.text-emerald-600]="summary.successRate >= 90"
            [class.text-neutral-900]="summary.successRate < 90"
          >
            {{ summary.successRate }}%
          </p>
        </div>

        <div class="rounded-2xl border border-neutral-200 bg-white p-5">
          <p class="text-sm text-neutral-500">Avg Duration</p>
          <p class="mt-1 text-2xl font-bold text-neutral-900">
            {{ formatDuration(summary.avgDurationSeconds) }}
          </p>
        </div>

        <div class="rounded-2xl border border-neutral-200 bg-white p-5">
          <p class="text-sm text-neutral-500">Failed</p>
          <p class="mt-1 text-2xl font-bold text-red-600">{{ summary.totalFailed }}</p>
        </div>
      </div>

      <div class="mt-6 grid gap-4 md:grid-cols-2">
        <section class="rounded-2xl border border-neutral-200 bg-white">
          <h3 class="border-b border-neutral-200 px-5 py-4 text-sm font-semibold text-neutral-900">
            By Platform
          </h3>
          <ul class="divide-y divide-neutral-100">
            @for (platform of platforms; track platform) {
              <li class="flex items-center justify-between px-5 py-3 text-sm">
                <span class="text-neutral-700">{{ platformLabels[platform] }}</span>
                <span class="text-neutral-900">{{ summary.byPlatform[platform].total }} builds</span>
              </li>
            }
          </ul>
        </section>

        <section class="rounded-2xl border border-neutral-200 bg-white">
          <h3 class="border-b border-neutral-200 px-5 py-4 text-sm font-semibold text-neutral-900">
            By Environment
          </h3>
          <ul class="divide-y divide-neutral-100">
            @for (env of environments; track env) {
              <li class="flex items-center justify-between px-5 py-3 text-sm">
                <span class="text-neutral-700">{{ environmentLabels[env] }}</span>
                <span class="text-neutral-900">{{ summary.byEnvironment[env].total }} builds</span>
              </li>
            }
          </ul>
        </section>
      </div>
    } @else {
      <p role="status" class="text-sm text-neutral-500">Loading analytics…</p>
    }
  `,
})
export class AnalyticsSummaryComponent {
  private readonly projectsService = inject(ProjectsService);

  readonly projectId = input.required<string>();

  protected readonly platforms = PLATFORMS;
  protected readonly environments = ENVIRONMENTS;
  protected readonly platformLabels = PLATFORM_LABELS;
  protected readonly environmentLabels = ENVIRONMENT_LABELS;

  protected readonly summary = signal<AnalyticsSummary | null>(null);
  protected readonly errorMessage = signal<string | null>(null);

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      this.summary.set(null);
      this.errorMessage.set(null);
      this.projectsService
        .getAnalyticsSummary(projectId)
        .then((summary) => this.summary.set(summary))
        .catch(() => this.errorMessage.set('Unable to load analytics summary.'));
    });
  }

  protected formatDuration(seconds: number): string {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  }
}
