import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SlackConfigFormComponent } from './slack-config-form';

@Component({
  selector: 'app-notifications-config',
  imports: [SlackConfigFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <div>
        <h2 class="text-lg font-bold tracking-tight text-neutral-900">Notifications</h2>
        <p class="mt-1 text-sm text-neutral-600">Get alerted on Slack when a build finishes.</p>
      </div>

      @if (errorMessage()) {
        <p role="alert" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {{ errorMessage() }}
        </p>
      } @else if (projectId(); as id) {
        <section class="rounded-2xl border border-neutral-200 bg-white p-6">
          <h3 class="text-sm font-semibold text-neutral-900">Slack Integration</h3>
          <div class="mt-4">
            <app-slack-config-form [projectId]="id" />
          </div>
        </section>
      }
    </div>
  `,
})
export class NotificationsConfig implements OnInit {
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
