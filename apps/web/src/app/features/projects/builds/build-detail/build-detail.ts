import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import QRCode from 'qrcode';
import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../core/auth/auth.service';
import { ProjectsService } from '../../../../core/projects/projects.service';
import type { Build, BuildStatus, Project, TriggeredBy } from '../../../../core/projects/project.models';
import { BuildStatusBadge } from '../../../../shared/ui/build-status-badge';
import { PlatformIcon } from '../../../../shared/ui/platform-icon';

const ACTIVE_STATUSES: BuildStatus[] = ['queued', 'running'];
const POLL_INTERVAL_MS = 4000;

// Miroir de DEFAULT_PLAN_QUOTAS côté API (apps/api/src/quotas/plan-quotas.model.ts) : la
// rétention réelle appliquée par ArtifactRetentionService vit côté serveur (peut être ajustée
// sans redéploiement du front via Firestore), cette carte ne sert qu'à afficher une date
// d'expiration indicative — jamais à bloquer une action.
const ARTIFACT_RETENTION_DAYS_BY_PLAN: Record<string, number | null> = {
  free: 7,
  starter: 30,
  pro: 90,
  enterprise: null,
};
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const TRIGGERED_BY_LABELS: Record<TriggeredBy, string> = {
  manual: 'Triggered manually',
  push: 'Triggered by a push to the branch',
};

const CARD_CLASS = 'rounded-2xl border border-neutral-200 bg-white p-5';
const DT_CLASS = 'text-xs font-semibold tracking-wide text-neutral-500 uppercase';
const DD_CLASS = 'mt-1 text-sm text-neutral-900';
const ACTION_BUTTON_CLASS =
  'inline-flex w-fit items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600 disabled:opacity-50';

@Component({
  selector: 'app-build-detail',
  imports: [RouterLink, PlatformIcon, BuildStatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      @if (errorMessage()) {
        <p role="alert" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {{ errorMessage() }}
        </p>
      }

      @if (project(); as project) {
        @if (build(); as build) {
          <div class="flex flex-col gap-1">
            <a
              class="inline-flex w-fit items-center gap-1 text-sm font-medium text-neutral-500 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
              [routerLink]="['/projects', project.id, 'builds']"
            >
              <svg aria-hidden="true" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              Builds
            </a>

            <div class="flex flex-wrap items-center justify-between gap-4">
              <div class="flex items-center gap-3">
                <app-platform-icon [platform]="build.platform" size="lg" />
                <div>
                  <h2 class="text-lg font-bold tracking-tight text-neutral-900 capitalize">
                    Build {{ build.platform }} · {{ build.environment }}
                  </h2>
                  <p class="font-mono text-xs text-neutral-500">{{ build.id }}</p>
                </div>
                <app-build-status-badge [status]="build.status" />
              </div>

              <div class="flex items-center gap-2">
                <button type="button" class="${ACTION_BUTTON_CLASS}" [disabled]="refreshing()" (click)="refresh()">
                  {{ refreshing() ? 'Refreshing…' : 'Refresh' }}
                </button>
                @if (build.logsUrl) {
                  <a class="${ACTION_BUTTON_CLASS}" [href]="build.logsUrl" target="_blank" rel="noopener noreferrer">
                    View on GitHub ↗
                  </a>
                }
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
            <section aria-labelledby="logs-heading" class="${CARD_CLASS}">
              <h3 id="logs-heading" class="text-sm font-semibold text-neutral-900">Logs</h3>
              <div class="mt-4 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
                <p class="text-sm text-neutral-600">
                  Detailed build logs are not yet displayed directly in MobileFlow — this is planned for a future version.
                </p>
                @if (build.logsUrl) {
                  <a
                    class="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                    [href]="build.logsUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View logs on GitHub Actions ↗
                  </a>
                }
              </div>
            </section>

            <aside class="flex flex-col gap-4">
              <div class="${CARD_CLASS}">
                <dl class="flex flex-col gap-3">
                  <div>
                    <dt class="${DT_CLASS}">Duration</dt>
                    <dd class="${DD_CLASS}">{{ formatDuration(build.durationSeconds) }}</dd>
                  </div>
                  <div>
                    <dt class="${DT_CLASS}">Build ID</dt>
                    <dd class="${DD_CLASS} font-mono text-xs">{{ build.id }}</dd>
                  </div>
                  <div>
                    <dt class="${DT_CLASS}">Platform</dt>
                    <dd class="${DD_CLASS} capitalize">{{ build.platform }}</dd>
                  </div>
                  <div>
                    <dt class="${DT_CLASS}">Environment</dt>
                    <dd class="${DD_CLASS} capitalize">{{ build.environment }}</dd>
                  </div>
                  <div>
                    <dt class="${DT_CLASS}">Triggered</dt>
                    <dd class="${DD_CLASS}">
                      {{ triggeredByLabels[build.triggeredBy] }}
                      <span class="block text-neutral-500">{{ formatDate(build.createdAt) }}</span>
                    </dd>
                  </div>
                </dl>
              </div>

              <div class="${CARD_CLASS}">
                <h3 class="${DT_CLASS}">Commit</h3>
                <p class="mt-1 text-sm text-neutral-900">{{ build.branch }}</p>
                <a
                  class="mt-0.5 inline-flex w-fit rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-600 hover:underline"
                  [href]="commitUrl(project, build)"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {{ build.commitSha.slice(0, 7) }}
                </a>
              </div>

              @if (showArtifacts(build)) {
                <div class="${CARD_CLASS}">
                  <h3 class="${DT_CLASS}">Artifacts</h3>
                  <div class="mt-2 flex flex-col items-start gap-2">
                    @if (build.artifactUrl) {
                      <a class="${ACTION_BUTTON_CLASS}" [href]="build.artifactUrl" target="_blank" rel="noopener noreferrer">
                        View on GitHub ↗
                      </a>
                    }
                    @if (build.environment === 'staging' && build.status === 'success') {
                      @if (!build.artifactStoragePath) {
                        <button type="button" class="${ACTION_BUTTON_CLASS}" [disabled]="installing()" (click)="installBuild(build.id)">
                          {{ installing() ? 'Preparing…' : 'Install' }}
                        </button>
                      } @else {
                        <button type="button" class="${ACTION_BUTTON_CLASS}" [disabled]="downloading()" (click)="downloadArtifact(build.id)">
                          {{ downloading() ? 'Preparing link…' : 'Download (hosted by MobileFlow)' }}
                        </button>
                        @if (artifactExpiresAt(build); as expiresAt) {
                          <p class="text-xs text-neutral-500">Available until {{ formatDate(expiresAt) }}</p>
                        }
                        @if (build.platform === 'ios') {
                          <a class="${ACTION_BUTTON_CLASS}" [href]="itmsServicesUrl(build.id)">Install on iPhone</a>
                          <button type="button" class="${ACTION_BUTTON_CLASS}" (click)="toggleQr(build.id)">
                            {{ qrDataUrl() ? 'Hide QR code' : 'Show QR code' }}
                          </button>
                          @if (qrDataUrl(); as qrDataUrl) {
                            <img
                              [src]="qrDataUrl"
                              alt="QR code d'installation iPhone pour ce build"
                              width="160"
                              height="160"
                              class="rounded-lg border border-neutral-200"
                            />
                          }
                        }
                      }
                    }
                  </div>
                </div>
              }
            </aside>
          </div>
        } @else if (!errorMessage()) {
          <p role="status" class="text-sm text-neutral-500">Chargement du build…</p>
        }
      } @else if (!errorMessage()) {
        <p role="status" class="text-sm text-neutral-500">Chargement…</p>
      }
    </div>
  `,
})
export class BuildDetail implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly projectsService = inject(ProjectsService);
  private readonly authService = inject(AuthService);

  protected readonly triggeredByLabels = TRIGGERED_BY_LABELS;
  protected readonly project = signal<Project | null>(null);
  protected readonly build = signal<Build | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly refreshing = signal(false);
  protected readonly installing = signal(false);
  protected readonly downloading = signal(false);
  protected readonly qrDataUrl = signal<string | null>(null);

  private projectId = '';
  private buildId = '';
  private pollHandle: ReturnType<typeof setInterval> | null = null;

  async ngOnInit(): Promise<void> {
    const projectId = this.route.snapshot.paramMap.get('id');
    const buildId = this.route.snapshot.paramMap.get('buildId');
    if (!projectId || !buildId) {
      this.errorMessage.set('Build introuvable.');
      return;
    }
    this.projectId = projectId;
    this.buildId = buildId;
    try {
      const [project, build] = await Promise.all([
        this.projectsService.get(projectId),
        this.projectsService.getBuild(projectId, buildId),
      ]);
      this.project.set(project);
      this.build.set(build);
      this.schedulePolling();
    } catch {
      this.errorMessage.set('Impossible de charger ce build.');
    }
  }

  ngOnDestroy(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
    }
  }

  protected async refresh(): Promise<void> {
    this.refreshing.set(true);
    try {
      this.build.set(await this.projectsService.refreshBuild(this.projectId, this.buildId));
    } catch {
      this.errorMessage.set('Unable to refresh this build.');
    } finally {
      this.refreshing.set(false);
    }
  }

  protected async installBuild(buildId: string): Promise<void> {
    this.installing.set(true);
    try {
      this.build.set(await this.projectsService.installBuild(this.projectId, buildId));
    } catch {
      this.errorMessage.set("Unable to prepare installation of this build.");
    } finally {
      this.installing.set(false);
    }
  }

  protected async downloadArtifact(buildId: string): Promise<void> {
    this.downloading.set(true);
    try {
      const { url } = await this.projectsService.getBuildArtifactUrl(this.projectId, buildId);
      window.open(url, '_blank', 'noopener');
    } catch {
      this.errorMessage.set('Unable to get download link.');
    } finally {
      this.downloading.set(false);
    }
  }

  protected itmsServicesUrl(buildId: string): string {
    const manifestUrl = `${environment.apiUrl}/builds/${buildId}/manifest.plist`;
    return `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;
  }

  protected async toggleQr(buildId: string): Promise<void> {
    if (this.qrDataUrl()) {
      this.qrDataUrl.set(null);
      return;
    }
    try {
      this.qrDataUrl.set(await QRCode.toDataURL(this.itmsServicesUrl(buildId), { margin: 1, width: 180 }));
    } catch {
      this.errorMessage.set('Unable to generate QR code.');
    }
  }

  protected artifactExpiresAt(build: Build): string | null {
    if (!build.artifactUploadedAt) {
      return null;
    }
    const retentionDays =
      ARTIFACT_RETENTION_DAYS_BY_PLAN[this.authService.currentUser()?.plan ?? 'free'] ?? null;
    if (retentionDays === null) {
      return null;
    }
    return new Date(new Date(build.artifactUploadedAt).getTime() + retentionDays * MS_PER_DAY).toISOString();
  }

  protected showArtifacts(build: Build): boolean {
    return build.artifactUrl !== null || (build.environment === 'staging' && build.status === 'success');
  }

  protected commitUrl(project: Project, build: Build): string {
    return `https://github.com/${project.githubRepoFullName}/commit/${build.commitSha}`;
  }

  protected formatDuration(seconds: number | null): string {
    if (seconds === null) {
      return '—';
    }
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
  }

  protected formatDate(iso: string | null): string {
    if (!iso) {
      return '—';
    }
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  }

  private schedulePolling(): void {
    this.pollHandle = setInterval(() => {
      const current = this.build();
      if (current && ACTIVE_STATUSES.includes(current.status) && !this.refreshing()) {
        void this.refresh();
      }
    }, POLL_INTERVAL_MS);
  }
}
