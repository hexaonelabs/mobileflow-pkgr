import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProjectsService } from '../../../core/projects/projects.service';
import type {
  AnalyticsSummary,
  Build,
  NotificationConfig,
  Project,
  RepoReadiness,
  Secret,
  SetupTriggerResult,
} from '../../../core/projects/project.models';
import { BuildStatusBadge } from '../../../shared/ui/build-status-badge';
import { PlatformIcon } from '../../../shared/ui/platform-icon';

@Component({
  selector: 'app-project-detail',
  imports: [RouterLink, ReactiveFormsModule, BuildStatusBadge, PlatformIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      @if (errorMessage()) {
        <p role="alert" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {{ errorMessage() }}
        </p>
      } @else if (project(); as project) {
        <section aria-label="Project details" class="rounded-2xl border border-neutral-200 bg-white p-6">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 class="text-lg font-bold tracking-tight text-neutral-900">{{ project.name }}</h2>
              <a
                class="mt-1 inline-flex items-center gap-1.5 rounded-sm text-sm text-neutral-500 transition-colors hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                [href]="'https://github.com/' + project.githubRepoFullName"
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg aria-hidden="true" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path
                    fill-rule="evenodd"
                    clip-rule="evenodd"
                    d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.221-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.269 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.295 2.747-1.026 2.747-1.026.546 1.378.203 2.397.1 2.65.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .268.18.58.688.482A10.02 10.02 0 0022 12.017C22 6.484 17.522 2 12 2z"
                  />
                </svg>
                {{ project.githubRepoFullName }}
                <svg aria-hidden="true" class="h-3.5 w-3.5 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H18m0 0v4.5M18 6l-7.5 7.5M6 10.5V18h7.5" />
                </svg>
              </a>
            </div>

            @if (readiness(); as readiness) {
              @if (readiness.androidPlatformAdded || readiness.iosPlatformAdded) {
                <div class="flex items-center gap-1.5" aria-label="Configured platforms">
                  @if (readiness.iosPlatformAdded) {
                    <app-platform-icon platform="ios" />
                  }
                  @if (readiness.androidPlatformAdded) {
                    <app-platform-icon platform="android" />
                  }
                </div>
              }
            }
          </div>

          <dl class="mt-5 grid grid-cols-2 gap-4 border-t border-neutral-100 pt-4 sm:grid-cols-4">
            <div>
              <dt class="text-xs text-neutral-500">Project ID</dt>
              <dd class="mt-0.5 flex items-center gap-1.5">
                <span class="truncate font-mono text-xs text-neutral-700">{{ project.id }}</span>
                <button
                  type="button"
                  class="shrink-0 rounded-sm text-neutral-400 transition-colors hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                  [attr.aria-label]="copied() ? 'Project ID copied' : 'Copy project ID'"
                  (click)="copyProjectId(project.id)"
                >
                  @if (copied()) {
                    <svg class="h-3.5 w-3.5 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  } @else {
                    <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3a2.25 2.25 0 00-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185.639-.074 1.28-.135 1.927-.184"
                      />
                    </svg>
                  }
                </button>
              </dd>
            </div>
            <div>
              <dt class="text-xs text-neutral-500">Framework</dt>
              <dd class="mt-0.5 text-sm text-neutral-900 capitalize">{{ project.framework }}</dd>
            </div>
            <div>
              <dt class="text-xs text-neutral-500">Auto-trigger branch</dt>
              <dd class="mt-0.5 text-sm text-neutral-900">{{ project.autoTriggerBranch || 'Disabled' }}</dd>
            </div>
            <div>
              <dt class="text-xs text-neutral-500">Signing secrets</dt>
              <dd class="mt-0.5 text-sm text-neutral-900">
                {{ hasSecrets() ? secretsCount() + ' stored' : 'Not configured' }}
              </dd>
            </div>
          </dl>
        </section>

        <section aria-label="Project setup checklist" class="rounded-2xl border border-neutral-200 bg-white p-6">
          @if (checklistExpanded()) {
            <div class="flex items-center justify-between gap-4">
              <h3 class="text-sm font-semibold text-neutral-900">Get your project ready</h3>
              @if (requiredStepsDone()) {
                <button
                  type="button"
                  class="rounded-sm text-xs font-medium text-neutral-500 transition-colors hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                  (click)="toggleChecklist()"
                >
                  Hide
                </button>
              }
            </div>
            <p class="mt-1 text-sm text-neutral-600">
              Complete these steps to start shipping builds to your team.
            </p>

            <ul class="mt-4 flex flex-col gap-4">
              <li class="flex items-start gap-3">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  [class]="isFullyReady() ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'"
                  aria-hidden="true"
                >
                  {{ isFullyReady() ? '✓' : '1' }}
                </span>
                <div class="flex-1">
                  <p class="text-sm font-medium text-neutral-900">Prepare your repository</p>
                  <p class="text-xs text-neutral-500">
                    @if (isFullyReady()) {
                      Capacitor and at least one platform are set up.
                    } @else {
                      Install Capacitor and add the Android/iOS platforms — auto-configure it in one
                      click, or follow the manual steps yourself.
                    }
                  </p>
                </div>
                <button
                  type="button"
                  class="shrink-0 self-center rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                  (click)="openRepositorySetupModal()"
                >
                  {{ hasMissingReadinessSteps() ? 'Configure' : 'View details' }}
                </button>
              </li>

              <li class="flex items-start gap-3">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  [class]="hasSecrets() ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'"
                  aria-hidden="true"
                >
                  {{ hasSecrets() ? '✓' : '2' }}
                </span>
                <div class="flex-1">
                  <p class="text-sm font-medium text-neutral-900">Add your signing secrets</p>
                  <p class="text-xs text-neutral-500">
                    @if (hasSecrets()) {
                      {{ secretsCount() }} secret{{ secretsCount() > 1 ? 's' : '' }} stored.
                    } @else {
                      iOS certificates and Android keystores are required to produce installable builds.
                    }
                  </p>
                </div>
                @if (!hasSecrets()) {
                  <a
                    class="shrink-0 self-center rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                    [routerLink]="['/projects', project.id, 'secrets']"
                  >
                    Configure
                  </a>
                }
              </li>

              <li class="flex items-start gap-3">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  [class]="hasBuilds() ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'"
                  aria-hidden="true"
                >
                  {{ hasBuilds() ? '✓' : '3' }}
                </span>
                <div class="flex-1">
                  <p class="text-sm font-medium text-neutral-900">Trigger your first build</p>
                  <p class="text-xs text-neutral-500">
                    @if (hasBuilds()) {
                      You've started {{ buildsCount() }} build{{ buildsCount() > 1 ? 's' : '' }}.
                    } @else {
                      Launch a manual build to test your setup end-to-end.
                    }
                  </p>
                </div>
                @if (!hasBuilds()) {
                  <a
                    class="shrink-0 self-center rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                    [routerLink]="['/projects', project.id, 'builds', 'new']"
                  >
                    Start a build
                  </a>
                }
              </li>

              <li class="flex items-start gap-3">
                <span
                  class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  [class]="notificationsEnabled() ? 'bg-green-50 text-green-700' : 'bg-neutral-100 text-neutral-400'"
                  aria-hidden="true"
                >
                  {{ notificationsEnabled() ? '✓' : '·' }}
                </span>
                <div class="flex-1">
                  <p class="text-sm font-medium text-neutral-900">
                    Connect notifications
                    <span class="ml-1 text-xs font-normal text-neutral-400">(optional)</span>
                  </p>
                  <p class="text-xs text-neutral-500">
                    @if (notificationsEnabled()) {
                      Slack alerts are enabled for this project.
                    } @else {
                      Get a Slack message when a build starts, succeeds or fails.
                    }
                  </p>
                </div>
                @if (!notificationsEnabled()) {
                  <a
                    class="shrink-0 self-center rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                    [routerLink]="['/projects', project.id, 'notifications']"
                  >
                    Set up
                  </a>
                }
              </li>
            </ul>
          } @else {
            <div class="flex items-center justify-between gap-4">
              <p class="flex items-center gap-2 text-sm text-neutral-700">
                <span
                  class="flex h-5 w-5 items-center justify-center rounded-full bg-green-50 text-xs font-bold text-green-700"
                  aria-hidden="true"
                >
                  ✓
                </span>
                Your project is fully set up.
              </p>
              <button
                type="button"
                class="rounded-sm text-xs font-medium text-accent-700 transition-colors hover:text-accent-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                (click)="toggleChecklist()"
              >
                Review checklist
              </button>
            </div>
          }
        </section>

        <section aria-label="Quick actions" class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div class="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5">
            <span
              class="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-neutral-700"
              aria-hidden="true"
            >
              <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.63 8.34m5.96 6.03a14.926 14.926 0 01-5.841 2.58m-.119-8.61a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"
                />
              </svg>
            </span>
            <div class="flex-1">
              <p class="text-sm font-semibold text-neutral-900">Start a build</p>
              <p class="mt-1 text-xs text-neutral-500">
                Compile and sign a fresh iOS or Android build from any branch, on demand.
              </p>
            </div>
            <a
              class="mt-1 inline-flex w-fit items-center gap-1 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
              [routerLink]="['/projects', project.id, 'builds', 'new']"
            >
              Start a build
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </a>
          </div>

          <div class="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5">
            <span
              class="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-neutral-700"
              aria-hidden="true"
            >
              <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
                />
              </svg>
            </span>
            <div class="flex-1">
              <p class="text-sm font-semibold text-neutral-900">Signing secrets</p>
              <p class="mt-1 text-xs text-neutral-500">
                iOS certificates and Android keystores used to sign your builds.
              </p>
              @if (hasSecrets()) {
                <p class="mt-1 text-xs font-medium text-neutral-700">{{ secretsCount() }} stored</p>
              } @else {
                <p class="mt-1 text-xs font-medium text-amber-700">Not configured yet</p>
              }
            </div>
            <a
              class="mt-1 inline-flex w-fit items-center gap-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
              [routerLink]="['/projects', project.id, 'secrets']"
            >
              {{ hasSecrets() ? 'Manage secrets' : 'Add a secret' }}
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </a>
          </div>

          <div class="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-5">
            <div class="flex items-center justify-between">
              <span
                class="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-neutral-700"
                aria-hidden="true"
              >
                <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
                  />
                </svg>
              </span>
              @if (latestBuild(); as build) {
                <app-build-status-badge [status]="build.status" />
              }
            </div>
            <div class="flex-1">
              <p class="text-sm font-semibold text-neutral-900">Analytics</p>
              <p class="mt-1 text-xs text-neutral-500">
                Success rate, build volume and trends for this project.
              </p>
              @if (analyticsSummary(); as summary) {
                @if (summary.totalBuilds > 0) {
                  <p class="mt-1 text-xs font-medium text-neutral-700">
                    {{ summary.totalBuilds }} builds · {{ summary.successRate }}% success
                  </p>
                } @else {
                  <p class="mt-1 text-xs font-medium text-neutral-500">No builds yet</p>
                }
              } @else {
                <p class="mt-1 text-xs text-neutral-500">—</p>
              }
            </div>
            <a
              class="mt-1 inline-flex w-fit items-center gap-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
              [routerLink]="['/projects', project.id, 'analytics']"
            >
              View analytics
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </a>
          </div>
        </section>

        <section aria-labelledby="auto-trigger-heading" class="rounded-2xl border border-neutral-200 bg-white p-6">
          <h3 id="auto-trigger-heading" class="text-sm font-semibold text-neutral-900">Auto-trigger on push</h3>
          <p class="mt-1 text-sm text-neutral-600">
            Automatically start a staging build (Android + iOS) whenever a commit is pushed to the
            branch below. Leave empty to disable.
          </p>

          <form
            class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
            [formGroup]="autoTriggerForm"
            (ngSubmit)="saveAutoTrigger()"
            novalidate
          >
            <div class="flex flex-1 flex-col gap-1">
              <label class="text-sm font-medium text-neutral-900" for="auto-trigger-branch">Branch</label>
              <input
                id="auto-trigger-branch"
                type="text"
                placeholder="e.g. main (empty = disabled)"
                class="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600"
                formControlName="autoTriggerBranch"
              />
            </div>
            <button
              type="submit"
              class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
              [disabled]="autoTriggerSaving()"
            >
              {{ autoTriggerSaving() ? 'Saving…' : 'Save' }}
            </button>
          </form>

          @if (autoTriggerSaved()) {
            <p class="mt-3 text-sm text-green-700">Auto-trigger setting saved.</p>
          }
          @if (autoTriggerError()) {
            <p role="alert" class="mt-3 text-sm text-red-600">{{ autoTriggerError() }}</p>
          }
        </section>

        <details class="group rounded-2xl border border-red-200 bg-white">
          <summary
            class="flex cursor-pointer list-none items-center justify-between rounded-2xl px-6 py-4 text-sm font-semibold text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 [&::-webkit-details-marker]:hidden"
          >
            <span>Danger zone</span>
            <svg
              class="h-4 w-4 shrink-0 text-red-500 transition-transform group-open:rotate-180"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              aria-hidden="true"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </summary>

          <div class="flex flex-col gap-6 border-t border-red-100 px-6 py-6">
            <section aria-labelledby="workflow-heading">
              <h3 id="workflow-heading" class="text-sm font-semibold text-neutral-900">Build workflow</h3>
              <p class="mt-1 text-sm text-neutral-600">
                MobileFlow installs the workflow ({{ '.github/workflows/mobileflow.yml' }}) only once.
                You can then customize it freely — it will never be overwritten automatically.
              </p>

              <div class="mt-4 flex flex-col gap-2">
                @if (!resetConfirming()) {
                  <button
                    type="button"
                    class="self-start rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                    (click)="resetConfirming.set(true)"
                  >
                    Reset workflow to default template
                  </button>
                } @else {
                  <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
                    <p class="text-red-900">
                      This will <strong>overwrite</strong> the current workflow file on the default branch
                      of {{ project.githubRepoFullName }}, including any customizations you've made.
                    </p>
                    <div class="mt-3 flex gap-2">
                      <button
                        type="button"
                        class="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                        [disabled]="resetting()"
                        (click)="resetWorkflow()"
                      >
                        {{ resetting() ? 'Resetting…' : 'Confirm' }}
                      </button>
                      <button
                        type="button"
                        class="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                        (click)="resetConfirming.set(false)"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                }
              </div>

              @if (resetDone()) {
                <p class="mt-3 text-sm text-green-700">Workflow reset to default template.</p>
              }
              @if (resetError()) {
                <p role="alert" class="mt-3 text-sm text-red-600">{{ resetError() }}</p>
              }
            </section>

            <section aria-label="Delete project">
              <h3 class="text-sm font-semibold text-neutral-900">Delete project</h3>
              <p class="mt-1 text-sm text-neutral-600">
                Permanently remove this project from MobileFlow, including its build history and stored secrets.
              </p>
              <button
                type="button"
                class="mt-4 self-start rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                (click)="remove()"
              >
                Delete project
              </button>
            </section>
          </div>
        </details>

        @if (repositorySetupModalOpen()) {
          <button
            type="button"
            class="fixed inset-0 z-40 cursor-default bg-neutral-900/50"
            aria-hidden="true"
            tabindex="-1"
            (click)="closeRepositorySetupModal()"
          ></button>

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="repo-setup-modal-heading"
            class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-12 sm:pt-20"
            (keydown.escape)="closeRepositorySetupModal()"
          >
            <div class="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl">
              <div class="flex items-center justify-between gap-4">
                <h3 id="repo-setup-modal-heading" class="text-sm font-semibold text-neutral-900">
                  Repository setup
                </h3>
                <button
                  type="button"
                  aria-label="Close"
                  class="rounded-sm p-1 text-neutral-400 transition-colors hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                  (click)="closeRepositorySetupModal()"
                >
                  <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              @if (readiness(); as readiness) {
                <ul class="mt-4 flex flex-col gap-2">
                  <li class="flex items-center gap-2 text-sm">
                    <span
                      class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                      [class]="readiness.capacitorInstalled ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'"
                      aria-hidden="true"
                    >
                      {{ readiness.capacitorInstalled ? '✓' : '!' }}
                    </span>
                    <span class="text-neutral-700">
                      Capacitor installed (@capacitor/core in package.json)
                    </span>
                  </li>
                  <li class="flex items-center gap-2 text-sm">
                    <span
                      class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                      [class]="readiness.androidPlatformAdded ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'"
                      aria-hidden="true"
                    >
                      {{ readiness.androidPlatformAdded ? '✓' : '!' }}
                    </span>
                    <span class="text-neutral-700">Android platform added (android/ folder)</span>
                  </li>
                  <li class="flex items-center gap-2 text-sm">
                    <span
                      class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                      [class]="readiness.iosPlatformAdded ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'"
                      aria-hidden="true"
                    >
                      {{ readiness.iosPlatformAdded ? '✓' : '!' }}
                    </span>
                    <span class="text-neutral-700">iOS platform added (ios/ folder)</span>
                  </li>
                </ul>

                @if (hasMissingReadinessSteps()) {
                  <div class="mt-4 rounded-xl border border-accent-100 bg-accent-50 p-4">
                    <p class="text-sm font-medium text-accent-900">Let MobileFlow configure it for you</p>
                    <p class="mt-1 text-sm text-accent-800">
                      We'll install Capacitor and add the missing platforms with a single commit to
                      {{ project.githubRepoFullName }}. This is the fastest way to get building.
                    </p>

                    <div class="mt-3 flex flex-col gap-2">
                      @if (!setupConfirming()) {
                        <button
                          type="button"
                          class="self-start rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                          (click)="setupConfirming.set(true)"
                        >
                          Auto-configure
                        </button>
                      } @else {
                        <div class="rounded-xl border border-white bg-white p-4 text-sm">
                          <p class="text-neutral-700">
                            This will push a commit to your GitHub repository ({{ project.githubRepoFullName }})
                            to install Capacitor and/or add missing platforms.
                          </p>
                          <div class="mt-3 flex flex-col gap-1">
                            <label class="text-sm font-medium text-neutral-900" for="web-dir">
                              Web build directory (webDir)
                            </label>
                            <input
                              id="web-dir"
                              type="text"
                              class="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600"
                              [value]="webDir()"
                              (input)="webDir.set($any($event.target).value)"
                            />
                            <p class="text-xs text-neutral-600">
                              Directory where your build command (e.g. <code>npm run build</code>) generates static files.
                              Default is "www", but depends on your framework (e.g. Angular: dist/&lt;project-name&gt;/browser).
                            </p>
                          </div>
                          <div class="mt-3 flex gap-2">
                            <button
                              type="button"
                              class="rounded-lg bg-accent-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-accent-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                              [disabled]="settingUp()"
                              (click)="triggerSetup()"
                            >
                              {{ settingUp() ? 'Starting…' : 'Confirm' }}
                            </button>
                            <button
                              type="button"
                              class="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                              (click)="setupConfirming.set(false)"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      }
                    </div>

                    @if (setupResult(); as result) {
                      <p class="mt-3 text-sm text-green-700">
                        Setup started.
                        @if (result.htmlUrl) {
                          <a
                            class="underline underline-offset-2"
                            [href]="result.htmlUrl"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View run on GitHub
                          </a>
                        }
                        — refresh this page in a minute to see the updated status.
                      </p>
                    }
                    @if (setupError()) {
                      <p role="alert" class="mt-3 text-sm text-red-600">{{ setupError() }}</p>
                    }
                  </div>
                } @else {
                  <p class="mt-4 text-sm text-green-700">
                    Your repository is fully configured — there's nothing left to do here.
                  </p>
                }

                <div class="mt-4 border-t border-neutral-100 pt-4">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-neutral-500 transition-colors hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                    [attr.aria-expanded]="manualStepsExpanded()"
                    (click)="manualStepsExpanded.set(!manualStepsExpanded())"
                  >
                    @if (hasMissingReadinessSteps()) {
                      Prefer to configure it manually?
                    } @else {
                      View the manual setup commands
                    }
                    <svg
                      class="h-3.5 w-3.5 transition-transform"
                      [class.rotate-180]="manualStepsExpanded()"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      aria-hidden="true"
                    >
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>

                  @if (manualStepsExpanded()) {
                    <pre class="mt-2 overflow-x-auto rounded-lg bg-neutral-900 p-3 text-xs text-neutral-100">{{ hasMissingReadinessSteps() ? setupCommand() : fullSetupCommand() }}</pre>
                    <p class="mt-2 text-xs text-neutral-500">then commit and push the generated files.</p>
                  }
                </div>
              } @else if (!readinessError()) {
                <p role="status" class="mt-4 text-sm text-neutral-500">Analyzing repository…</p>
              }
              @if (readinessError()) {
                <p role="alert" class="mt-4 text-sm text-red-600">{{ readinessError() }}</p>
              }
            </div>
          </div>
        }
      } @else {
        <p role="status" class="text-sm text-neutral-500">Loading project…</p>
      }
    </div>
  `,
})
export class ProjectDetail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly projectsService = inject(ProjectsService);
  private readonly fb = inject(FormBuilder);

  protected readonly project = signal<Project | null>(null);
  protected readonly readiness = signal<RepoReadiness | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly readinessError = signal<string | null>(null);
  protected readonly setupConfirming = signal(false);
  protected readonly settingUp = signal(false);
  protected readonly webDir = signal('www');
  protected readonly setupResult = signal<SetupTriggerResult | null>(null);
  protected readonly setupError = signal<string | null>(null);
  protected readonly resetConfirming = signal(false);
  protected readonly resetting = signal(false);
  protected readonly resetDone = signal(false);
  protected readonly resetError = signal<string | null>(null);

  protected readonly autoTriggerForm = this.fb.nonNullable.group({ autoTriggerBranch: [''] });
  protected readonly autoTriggerSaving = signal(false);
  protected readonly autoTriggerSaved = signal(false);
  protected readonly autoTriggerError = signal<string | null>(null);

  protected readonly secrets = signal<Secret[] | null>(null);
  protected readonly notificationConfig = signal<NotificationConfig | null>(null);
  protected readonly analyticsSummary = signal<AnalyticsSummary | null>(null);
  protected readonly builds = signal<Build[] | null>(null);
  protected readonly checklistManuallyExpanded = signal<boolean | null>(null);
  protected readonly copied = signal(false);
  protected readonly repositorySetupModalOpen = signal(false);
  protected readonly manualStepsExpanded = signal(false);

  protected readonly isFullyReady = computed(() => {
    const readiness = this.readiness();
    return !!readiness?.capacitorInstalled && (readiness.androidPlatformAdded || readiness.iosPlatformAdded);
  });

  protected readonly hasMissingReadinessSteps = computed(() => {
    const readiness = this.readiness();
    if (!readiness) {
      return false;
    }
    return !readiness.capacitorInstalled || !readiness.androidPlatformAdded || !readiness.iosPlatformAdded;
  });

  protected readonly setupCommand = computed(() => {
    const readiness = this.readiness();
    if (!readiness) {
      return '';
    }
    const steps: string[] = [];
    if (!readiness.capacitorInstalled) {
      steps.push('npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios');
      steps.push('npx cap init');
    }
    if (!readiness.androidPlatformAdded) {
      steps.push('npx cap add android');
    }
    if (!readiness.iosPlatformAdded) {
      steps.push('npx cap add ios');
    }
    return steps.join('\n');
  });

  protected readonly fullSetupCommand = computed(() =>
    [
      'npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios',
      'npx cap init',
      'npx cap add android',
      'npx cap add ios',
    ].join('\n'),
  );

  protected readonly secretsCount = computed(() => this.secrets()?.length ?? 0);
  protected readonly hasSecrets = computed(() => this.secretsCount() > 0);
  protected readonly buildsCount = computed(() => this.builds()?.length ?? 0);
  protected readonly hasBuilds = computed(() => this.buildsCount() > 0);
  protected readonly latestBuild = computed(() => this.builds()?.[0] ?? null);
  protected readonly notificationsEnabled = computed(() => !!this.notificationConfig()?.slack?.enabled);

  protected readonly requiredStepsDone = computed(
    () => this.isFullyReady() && this.hasSecrets() && this.hasBuilds(),
  );
  protected readonly checklistExpanded = computed(
    () => this.checklistManuallyExpanded() ?? !this.requiredStepsDone(),
  );

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.errorMessage.set('Project not found.');
      return;
    }
    try {
      const project = await this.projectsService.get(id);
      this.project.set(project);
      this.autoTriggerForm.patchValue({ autoTriggerBranch: project.autoTriggerBranch ?? '' });
    } catch {
      this.errorMessage.set('Unable to load project.');
      return;
    }

    void this.loadReadiness(id);
    void this.loadOverviewData(id);
  }

  private async loadReadiness(id: string): Promise<void> {
    try {
      this.readiness.set(await this.projectsService.getReadiness(id));
    } catch {
      this.readinessError.set('Unable to analyze repository.');
    }
  }

  private async loadOverviewData(id: string): Promise<void> {
    const [secrets, notificationConfig, analyticsSummary, builds] = await Promise.allSettled([
      this.projectsService.listSecrets(id),
      this.projectsService.getNotificationConfig(id),
      this.projectsService.getAnalyticsSummary(id),
      this.projectsService.listBuilds(id),
    ]);
    if (secrets.status === 'fulfilled') {
      this.secrets.set(secrets.value);
    }
    if (notificationConfig.status === 'fulfilled') {
      this.notificationConfig.set(notificationConfig.value);
    }
    if (analyticsSummary.status === 'fulfilled') {
      this.analyticsSummary.set(analyticsSummary.value);
    }
    if (builds.status === 'fulfilled') {
      this.builds.set(builds.value);
    }
  }

  protected toggleChecklist(): void {
    this.checklistManuallyExpanded.set(!this.checklistExpanded());
  }

  protected openRepositorySetupModal(): void {
    this.manualStepsExpanded.set(false);
    this.repositorySetupModalOpen.set(true);
  }

  protected closeRepositorySetupModal(): void {
    this.repositorySetupModalOpen.set(false);
  }

  protected async copyProjectId(id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(id);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      // Clipboard API unavailable — nothing to fall back to.
    }
  }

  protected async triggerSetup(): Promise<void> {
    const project = this.project();
    if (!project) {
      return;
    }
    this.settingUp.set(true);
    this.setupError.set(null);
    try {
      this.setupResult.set(await this.projectsService.triggerSetup(project.id, this.webDir()));
      this.setupConfirming.set(false);
    } catch {
      this.setupError.set('Unable to start auto-configuration.');
    } finally {
      this.settingUp.set(false);
    }
  }

  protected async resetWorkflow(): Promise<void> {
    const project = this.project();
    if (!project) {
      return;
    }
    this.resetting.set(true);
    this.resetError.set(null);
    try {
      await this.projectsService.resetBuildWorkflow(project.id);
      this.resetDone.set(true);
      this.resetConfirming.set(false);
    } catch {
      this.resetError.set('Unable to reset workflow.');
    } finally {
      this.resetting.set(false);
    }
  }

  protected async saveAutoTrigger(): Promise<void> {
    const project = this.project();
    if (!project) {
      return;
    }
    this.autoTriggerSaving.set(true);
    this.autoTriggerError.set(null);
    this.autoTriggerSaved.set(false);
    const branch = this.autoTriggerForm.getRawValue().autoTriggerBranch.trim();
    try {
      const updated = await this.projectsService.update(project.id, {
        name: project.name,
        autoTriggerBranch: branch || null,
      });
      this.project.set(updated);
      this.autoTriggerForm.patchValue({ autoTriggerBranch: updated.autoTriggerBranch ?? '' });
      this.autoTriggerSaved.set(true);
    } catch {
      this.autoTriggerError.set('Unable to save the auto-trigger setting.');
    } finally {
      this.autoTriggerSaving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const project = this.project();
    if (!project) {
      return;
    }
    try {
      await this.projectsService.remove(project.id);
      await this.router.navigateByUrl('/projects');
    } catch {
      this.errorMessage.set('Unable to delete project.');
    }
  }
}
