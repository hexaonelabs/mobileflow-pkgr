import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { BuildStatus } from '../../core/projects/project.models';

const STATUS_LABELS: Record<BuildStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  success: 'Success',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_BADGE_CLASSES: Record<BuildStatus, string> = {
  queued: 'bg-amber-50 text-amber-700',
  running: 'bg-amber-50 text-amber-700',
  success: 'bg-green-50 text-green-500',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-neutral-100 text-neutral-500',
};

@Component({
  selector: 'app-build-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="inline-flex items-center gap-1.5 rounded-full text-xs font-medium"
      [class]="badgeClass()"
    >
      @switch (status()) {
        @case ('success') {
          <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fill-rule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
              clip-rule="evenodd"
            />
          </svg>
        }
        @case ('failed') {
          <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fill-rule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
              clip-rule="evenodd"
            />
          </svg>
        }
        @case ('cancelled') {
          <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fill-rule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9.25a.75.75 0 000 1.5h6a.75.75 0 000-1.5H7z"
              clip-rule="evenodd"
            />
          </svg>
        }
        @case ('queued') {
          <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fill-rule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z"
              clip-rule="evenodd"
            />
          </svg>
        }
        @case ('running') {
          <svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle class="opacity-25" cx="10" cy="10" r="7" stroke="currentColor" stroke-width="3" />
            <path d="M17 10a7 7 0 00-7-7" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
        }
      }
    </span>
  `,
})
export class BuildStatusBadge {
  readonly status = input.required<BuildStatus>();

  protected readonly label = computed(() => STATUS_LABELS[this.status()]);
  protected readonly badgeClass = computed(() => STATUS_BADGE_CLASSES[this.status()]);
}
