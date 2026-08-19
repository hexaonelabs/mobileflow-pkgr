import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import QRCode from 'qrcode';
import { environment } from '../../../../environments/environment';
import { ProjectsService } from '../../../core/projects/projects.service';
import type { Build, BuildStatus, Project } from '../../../core/projects/project.models';
import { BuildStatusBadge } from '../../../shared/ui/build-status-badge';
import { PlatformIcon } from '../../../shared/ui/platform-icon';

const ACTIVE_STATUSES: BuildStatus[] = ['queued', 'running'];
const POLL_INTERVAL_MS = 4000;

const MENU_ITEM_CLASS =
  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-600 disabled:opacity-50';
const MENU_WIDTH = 256;
const MENU_MAX_HEIGHT = 320;

@Component({
  selector: 'app-project-builds',
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
        <div class="flex flex-wrap items-center justify-between gap-4">
          <h2 class="text-lg font-bold tracking-tight text-neutral-900">Builds</h2>
          <a
            class="inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
            [routerLink]="['/projects', project.id, 'builds', 'new']"
          >
            Start a build
          </a>
        </div>

        @if (builds(); as list) {
          @if (list.length === 0) {
            <div class="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center">
              <p class="text-sm text-neutral-600">No builds yet.</p>
            </div>
          } @else {
            <div class="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
              <table class="w-full text-left text-sm">
                <caption class="sr-only">Build history</caption>
                <thead class="border-b border-neutral-200 bg-neutral-50/70">
                  <tr>
                    <th scope="col" class="px-5 py-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                      Build
                    </th>
                    <th scope="col" class="px-5 py-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                      Status
                    </th>
                    <th scope="col" class="px-5 py-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                      Platform
                    </th>
                    <th scope="col" class="px-5 py-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                      Branch / commit
                    </th>
                    <th scope="col" class="px-5 py-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                      Duration
                    </th>
                    <th scope="col" class="px-5 py-3"><span class="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-neutral-100">
                  @for (build of list; track build.id; let i = $index) {
                    <tr class="transition-colors hover:bg-neutral-50/80">
                      <td class="px-5 py-4 font-semibold text-neutral-900">
                        <a
                          class="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                          [routerLink]="['/projects', project.id, 'builds', build.id]"
                        >
                          #{{ list.length - i }}
                        </a>
                      </td>
                      <td class="px-5 py-4">
                        <app-build-status-badge [status]="build.status" />
                      </td>
                      <td class="px-5 py-4">
                        <div class="flex items-center gap-2">
                          <app-platform-icon [platform]="build.platform" />
                          <div>
                            <span class="block font-medium text-neutral-900 capitalize">{{
                              build.platform
                            }}</span>
                            <span class="block text-xs text-neutral-500 capitalize">{{
                              build.environment
                            }}</span>
                          </div>
                        </div>
                      </td>
                      <td class="px-5 py-4 text-neutral-700">
                        {{ build.branch }}
                        <span
                          class="mt-0.5 block w-fit rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-500"
                        >
                          {{ build.commitSha.slice(0, 7) }}
                        </span>
                      </td>
                      <td class="px-5 py-4 text-neutral-500">
                        {{ build.durationSeconds !== null ? build.durationSeconds + 's' : '—' }}
                      </td>
                      <td class="px-5 py-4 text-right">
                        <button
                          type="button"
                          class="rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                          aria-haspopup="menu"
                          [attr.aria-expanded]="openBuild()?.id === build.id"
                          [attr.aria-label]="'Actions for build ' + (list.length - i)"
                          (click)="toggleMenu(build, $event)"
                          (keydown.escape)="closeMenu()"
                        >
                          <svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="1.6" />
                            <circle cx="12" cy="12" r="1.6" />
                            <circle cx="12" cy="19" r="1.6" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                    @if (qrDataUrls().has(build.id)) {
                      <tr>
                        <td colspan="6" class="bg-neutral-50 px-5 py-4">
                          <img
                            [src]="qrDataUrls().get(build.id)"
                            alt="QR code to install iPhone build"
                            width="160"
                            height="160"
                            class="rounded-lg border border-neutral-200"
                          />
                        </td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>
          }
        } @else if (!errorMessage()) {
          <p role="status" class="text-sm text-neutral-500">Loading builds…</p>
        }
      } @else if (!errorMessage()) {
        <p role="status" class="text-sm text-neutral-500">Loading…</p>
      }

      @if (openBuild(); as build) {
        <button
          type="button"
          class="fixed inset-0 z-10 cursor-default"
          aria-hidden="true"
          tabindex="-1"
          (click)="closeMenu()"
        ></button>

        <div
          role="menu"
          class="fixed z-20 w-64 rounded-xl border border-neutral-200 bg-white p-1.5 text-left"
          [style.top.px]="menuPosition()?.top"
          [style.left.px]="menuPosition()?.left"
          (keydown.escape)="closeMenu()"
        >
          @if (build.logsUrl) {
            <a
              role="menuitem"
              class="${MENU_ITEM_CLASS}"
              [href]="build.logsUrl"
              target="_blank"
              rel="noopener noreferrer"
              (click)="closeMenu()"
            >
              View run on GitHub
            </a>
          }
          @if (build.artifactUrl) {
            <a
              role="menuitem"
              class="${MENU_ITEM_CLASS}"
              [href]="build.artifactUrl"
              target="_blank"
              rel="noopener noreferrer"
              (click)="closeMenu()"
            >
              Download artifact
            </a>
          }
          @if (build.environment === 'staging' && build.status === 'success') {
            @if (!build.artifactStoragePath) {
              <button
                role="menuitem"
                type="button"
                class="${MENU_ITEM_CLASS}"
                [disabled]="installingIds().has(build.id)"
                (click)="installBuild(build.id); closeMenu()"
              >
                {{ installingIds().has(build.id) ? 'Preparing…' : 'Install' }}
              </button>
            } @else {
              <button
                role="menuitem"
                type="button"
                class="${MENU_ITEM_CLASS}"
                [disabled]="downloadingIds().has(build.id)"
                (click)="downloadArtifact(build.id); closeMenu()"
              >
                {{
                  downloadingIds().has(build.id)
                    ? 'Preparing link…'
                    : 'Download (hosted by MobileFlow)'
                }}
              </button>
              @if (build.platform === 'ios') {
                <a
                  role="menuitem"
                  class="${MENU_ITEM_CLASS}"
                  [href]="itmsServicesUrl(build.id)"
                  (click)="closeMenu()"
                >
                  Install on iPhone
                </a>
                <button
                  role="menuitem"
                  type="button"
                  class="${MENU_ITEM_CLASS}"
                  (click)="toggleQr(build.id); closeMenu()"
                >
                  {{ qrDataUrls().has(build.id) ? 'Hide QR code' : 'Show QR code' }}
                </button>
              }
            }
          }
          <div class="my-1 border-t border-neutral-100"></div>
          <button
            role="menuitem"
            type="button"
            class="${MENU_ITEM_CLASS}"
            [disabled]="refreshingIds().has(build.id)"
            (click)="refresh(build.id); closeMenu()"
          >
            {{ refreshingIds().has(build.id) ? 'Refreshing…' : 'Refresh' }}
          </button>
        </div>
      }
    </div>
  `,
})
export class ProjectBuilds implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly projectsService = inject(ProjectsService);

  protected readonly project = signal<Project | null>(null);
  protected readonly builds = signal<Build[] | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly refreshingIds = signal<Set<string>>(new Set());
  protected readonly downloadingIds = signal<Set<string>>(new Set());
  protected readonly installingIds = signal<Set<string>>(new Set());
  protected readonly qrDataUrls = signal<Map<string, string>>(new Map());
  protected readonly openBuild = signal<Build | null>(null);
  protected readonly menuPosition = signal<{ top: number; left: number } | null>(null);

  private projectId = '';
  private pollHandle: ReturnType<typeof setInterval> | null = null;

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.errorMessage.set('Project not found.');
      return;
    }
    this.projectId = id;
    try {
      const [project, builds] = await Promise.all([
        this.projectsService.get(id),
        this.projectsService.listBuilds(id),
      ]);
      this.project.set(project);
      this.builds.set(builds);
      this.schedulePolling();
    } catch {
      this.errorMessage.set('Unable to load build history.');
    }
  }

  ngOnDestroy(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
    }
  }

  protected toggleMenu(build: Build, event: MouseEvent): void {
    if (this.openBuild()?.id === build.id) {
      this.closeMenu();
      return;
    }

    const buttonRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const gap = 4;
    const left = Math.max(
      8,
      Math.min(buttonRect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
    );
    const top =
      buttonRect.bottom + gap + MENU_MAX_HEIGHT > window.innerHeight
        ? Math.max(8, buttonRect.top - gap - MENU_MAX_HEIGHT)
        : buttonRect.bottom + gap;

    this.menuPosition.set({ top, left });
    this.openBuild.set(build);
  }

  protected closeMenu(): void {
    this.openBuild.set(null);
    this.menuPosition.set(null);
  }

  protected async refresh(buildId: string): Promise<void> {
    this.refreshingIds.update((ids) => new Set(ids).add(buildId));
    try {
      const updated = await this.projectsService.refreshBuild(this.projectId, buildId);
      this.builds.update((list) =>
        (list ?? []).map((build) => (build.id === buildId ? updated : build)),
      );
    } catch {
      this.errorMessage.set('Unable to refresh this build.');
    } finally {
      this.refreshingIds.update((ids) => {
        const next = new Set(ids);
        next.delete(buildId);
        return next;
      });
    }
  }

  protected async downloadArtifact(buildId: string): Promise<void> {
    this.downloadingIds.update((ids) => new Set(ids).add(buildId));
    try {
      const { url } = await this.projectsService.getBuildArtifactUrl(this.projectId, buildId);
      window.open(url, '_blank', 'noopener');
    } catch {
      this.errorMessage.set('Unable to get download link.');
    } finally {
      this.downloadingIds.update((ids) => {
        const next = new Set(ids);
        next.delete(buildId);
        return next;
      });
    }
  }

  // On-demand hosting: the binary is extracted from the GitHub archive and uploaded to
  // Firebase Storage only if the user clicks "Install" (not systematically for each build),
  // to limit storage usage to actually installed staging builds.
  protected async installBuild(buildId: string): Promise<void> {
    this.installingIds.update((ids) => new Set(ids).add(buildId));
    try {
      const updated = await this.projectsService.installBuild(this.projectId, buildId);
      this.builds.update((list) =>
        (list ?? []).map((build) => (build.id === buildId ? updated : build)),
      );
    } catch {
      this.errorMessage.set("Unable to prepare installation of this build.");
    } finally {
      this.installingIds.update((ids) => {
        const next = new Set(ids);
        next.delete(buildId);
        return next;
      });
    }
  }

  // iOS Springboard triggers OTA installation by resolving this URL scheme, which points
  // to our public manifest.plist (see PublicBuildsController on the API side) — no direct HTTP
  // call is possible here, itms-services:// must be opened from Safari on the iPhone itself.
  protected itmsServicesUrl(buildId: string): string {
    const manifestUrl = `${environment.apiUrl}/builds/${buildId}/manifest.plist`;
    return `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;
  }

  protected async toggleQr(buildId: string): Promise<void> {
    const current = this.qrDataUrls();
    if (current.has(buildId)) {
      const next = new Map(current);
      next.delete(buildId);
      this.qrDataUrls.set(next);
      return;
    }
    try {
      const dataUrl = await QRCode.toDataURL(this.itmsServicesUrl(buildId), {
        margin: 1,
        width: 180,
      });
      const next = new Map(current);
      next.set(buildId, dataUrl);
      this.qrDataUrls.set(next);
    } catch {
      this.errorMessage.set('Unable to generate QR code.');
    }
  }

  private schedulePolling(): void {
    this.pollHandle = setInterval(() => {
      const activeBuilds = (this.builds() ?? []).filter((build) =>
        ACTIVE_STATUSES.includes(build.status),
      );
      for (const build of activeBuilds) {
        if (!this.refreshingIds().has(build.id)) {
          void this.refresh(build.id);
        }
      }
    }, POLL_INTERVAL_MS);
  }
}
