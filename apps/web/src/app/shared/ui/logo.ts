import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.class]="class()" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" class="fill-accent-600" />
      <g fill="white" opacity="0.35">
        <circle cx="7" cy="7" r="1.2" />
        <circle cx="12" cy="7" r="1.2" />
        <circle cx="17" cy="7" r="1.2" />
        <circle cx="7" cy="12" r="1.2" />
        <circle cx="12" cy="12" r="1.2" />
        <circle cx="17" cy="12" r="1.2" />
        <circle cx="7" cy="17" r="1.2" />
        <circle cx="12" cy="17" r="1.2" />
      </g>
      <circle cx="17" cy="17" r="1.2" fill="white" />
    </svg>
  `,
})
export class Logo {
  readonly class = input('h-7 w-7');
}
