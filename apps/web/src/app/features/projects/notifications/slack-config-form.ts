import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ProjectsService } from '../../../core/projects/projects.service';
import type { NotificationEvent } from '../../../core/projects/project.models';

const SLACK_WEBHOOK_PATTERN = /^https:\/\/hooks\.slack\.com\/.+/;

interface SlackEventsFormValue {
  buildStarted: boolean;
  buildSuccess: boolean;
  buildFailed: boolean;
}

@Component({
  selector: 'app-slack-config-form',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="flex flex-col gap-4" [formGroup]="form" (ngSubmit)="onSubmit()" novalidate>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium text-neutral-900" for="webhookUrl">Slack Webhook URL</label>
        <input
          id="webhookUrl"
          type="url"
          formControlName="webhookUrl"
          placeholder="https://hooks.slack.com/services/..."
          class="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600"
          [attr.aria-invalid]="isWebhookInvalid()"
          [attr.aria-describedby]="isWebhookInvalid() ? 'webhookUrl-error' : null"
        />
        <p class="text-xs text-neutral-500">
          Get this from
          <a class="underline hover:text-neutral-700" href="https://api.slack.com/apps" target="_blank" rel="noopener">
            Slack API
          </a>.
        </p>
        @if (isWebhookInvalid()) {
          <p id="webhookUrl-error" class="text-sm text-red-600" role="alert">
            A valid Slack webhook URL is required.
          </p>
        }
      </div>

      <fieldset class="flex flex-col gap-2" formGroupName="events">
        <legend class="text-sm font-medium text-neutral-900">Notify on events</legend>
        <label class="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            formControlName="buildStarted"
            class="h-4 w-4 rounded border-neutral-300 text-accent-600 focus:ring-accent-600"
          />
          Build started
        </label>
        <label class="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            formControlName="buildSuccess"
            class="h-4 w-4 rounded border-neutral-300 text-accent-600 focus:ring-accent-600"
          />
          Build succeeded
        </label>
        <label class="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            formControlName="buildFailed"
            class="h-4 w-4 rounded border-neutral-300 text-accent-600 focus:ring-accent-600"
          />
          Build failed
        </label>
      </fieldset>

      <label class="flex items-center gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          formControlName="enabled"
          class="h-4 w-4 rounded border-neutral-300 text-accent-600 focus:ring-accent-600"
        />
        Enabled
      </label>

      @if (successMessage()) {
        <p class="text-sm text-emerald-600" role="status">{{ successMessage() }}</p>
      }
      @if (errorMessage()) {
        <p class="text-sm text-red-600" role="alert">{{ errorMessage() }}</p>
      }

      <div class="flex items-center gap-3">
        <button
          type="button"
          class="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
          [disabled]="testing()"
          (click)="onTestMessage()"
        >
          {{ testing() ? 'Sending…' : 'Send test message' }}
        </button>
        <button
          type="submit"
          class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
          [disabled]="loading()"
        >
          {{ loading() ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </form>
  `,
})
export class SlackConfigFormComponent {
  private readonly projectsService = inject(ProjectsService);
  private readonly fb = inject(FormBuilder);

  readonly projectId = input.required<string>();

  protected readonly loading = signal(false);
  protected readonly testing = signal(false);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    webhookUrl: this.fb.nonNullable.control('', [
      Validators.required,
      Validators.pattern(SLACK_WEBHOOK_PATTERN),
    ]),
    enabled: this.fb.nonNullable.control(true),
    events: this.fb.nonNullable.group({
      buildStarted: this.fb.nonNullable.control(false),
      buildSuccess: this.fb.nonNullable.control(true),
      buildFailed: this.fb.nonNullable.control(true),
    }),
  });

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      this.successMessage.set(null);
      this.errorMessage.set(null);
      this.projectsService
        .getNotificationConfig(projectId)
        .then((config) => {
          if (!config.slack) return;
          this.form.setValue({
            webhookUrl: config.slack.webhookUrl,
            enabled: config.slack.enabled,
            events: {
              buildStarted: config.slack.events.includes('build.started'),
              buildSuccess: config.slack.events.includes('build.success'),
              buildFailed: config.slack.events.includes('build.failed'),
            },
          });
        })
        .catch(() => this.errorMessage.set('Unable to load the Slack configuration.'));
    });
  }

  protected isWebhookInvalid(): boolean {
    const control = this.form.controls.webhookUrl;
    return control.invalid && control.touched;
  }

  protected async onSubmit(): Promise<void> {
    this.successMessage.set(null);
    this.errorMessage.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    const { webhookUrl, enabled, events } = this.form.getRawValue();

    try {
      await this.projectsService.updateNotificationConfig(this.projectId(), {
        slack: { webhookUrl, enabled, events: this.toEventList(events) },
      });
      this.successMessage.set('Configuration saved.');
    } catch (err) {
      this.errorMessage.set(this.extractErrorMessage(err, 'Unable to save this configuration.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected async onTestMessage(): Promise<void> {
    this.successMessage.set(null);
    this.errorMessage.set(null);
    this.testing.set(true);

    try {
      await this.projectsService.testNotification(this.projectId());
      this.successMessage.set('Test message sent!');
    } catch (err) {
      this.errorMessage.set(this.extractErrorMessage(err, 'Unable to send the test message.'));
    } finally {
      this.testing.set(false);
    }
  }

  private toEventList(events: SlackEventsFormValue): NotificationEvent[] {
    const list: NotificationEvent[] = [];
    if (events.buildStarted) list.push('build.started');
    if (events.buildSuccess) list.push('build.success');
    if (events.buildFailed) list.push('build.failed');
    return list;
  }

  private extractErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const message = (err.error as { message?: string } | undefined)?.message;
      if (message) return message;
    }
    return fallback;
  }
}
