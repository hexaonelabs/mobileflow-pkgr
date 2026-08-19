import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.class]="class()" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" class="fill-accent-600" />
      <path
        d="M6 16.5V7.5l6 6 6-6v9"
        fill="none"
        stroke="white"
        stroke-width="1.9"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  `,
})
export class Logo {
  readonly class = input('h-7 w-7');
}
