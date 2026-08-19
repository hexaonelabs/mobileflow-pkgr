import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Platform } from '../../core/projects/project.models';

const SIZE_CLASSES: Record<'sm' | 'lg', { badge: string; icon: string }> = {
  sm: { badge: 'h-6 w-6', icon: 'h-3 w-3' },
  lg: { badge: 'h-10 w-10', icon: 'h-5 w-5' },
};

@Component({
  selector: 'app-platform-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (platform() === 'ios') {
      <span
        class="inline-flex shrink-0 items-center justify-center rounded-full bg-neutral-900"
        [class]="badgeClass()"
        aria-hidden="true"
      >
        <svg [class]="iconClass()" viewBox="0 0 24 24" fill="white">
          <path
            d="M17.05 12.04c-.02-2.1 1.72-3.11 1.8-3.16-.98-1.44-2.5-1.63-3.04-1.65-1.3-.13-2.53.76-3.19.76-.66 0-1.67-.74-2.75-.72-1.42.02-2.72.82-3.45 2.09-1.47 2.55-.38 6.32 1.06 8.39.7 1.01 1.53 2.14 2.63 2.1 1.05-.04 1.45-.68 2.72-.68 1.27 0 1.63.68 2.75.66 1.13-.02 1.85-1.02 2.55-2.03.8-1.17 1.13-2.3 1.15-2.36-.03-.01-2.19-.84-2.23-3.4zM14.98 5.7c.58-.71.98-1.68.87-2.66-.84.03-1.87.56-2.47 1.26-.54.62-1.02 1.62-.89 2.57.93.07 1.9-.47 2.49-1.17z"
          />
        </svg>
      </span>
    } @else {
      <span
        class="inline-flex shrink-0 items-center justify-center rounded-full bg-[#3DDC84]"
        [class]="badgeClass()"
        aria-hidden="true"
      >
        <svg [class]="iconClass()" viewBox="0 0 24 24" fill="white">
          <path
            d="M6.5 8.5v6a1 1 0 001 1h9a1 1 0 001-1v-6h-11zM8.3 5.3l-1-1.7a.4.4 0 01.7-.4l1.1 1.9a6.4 6.4 0 015.8 0l1.1-1.9a.4.4 0 01.7.4l-1 1.7a6.5 6.5 0 013 5.2H5.3a6.5 6.5 0 013-5.2zM9 8a.7.7 0 110-1.4A.7.7 0 019 8zm6 0a.7.7 0 110-1.4A.7.7 0 0115 8zM5 16.2v-5a.9.9 0 011.8 0v5a.9.9 0 01-1.8 0zm11.2 0v-5a.9.9 0 011.8 0v5a.9.9 0 01-1.8 0zM8 16.2v3.1a1 1 0 002 0v-3.1H8zm4 0v3.1a1 1 0 002 0v-3.1h-2z"
          />
        </svg>
      </span>
    }
  `,
})
export class PlatformIcon {
  readonly platform = input.required<Platform>();
  readonly size = input<'sm' | 'lg'>('sm');

  protected readonly badgeClass = computed(() => SIZE_CLASSES[this.size()].badge);
  protected readonly iconClass = computed(() => SIZE_CLASSES[this.size()].icon);
}
