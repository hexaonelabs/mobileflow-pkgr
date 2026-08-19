import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import QRCode from 'qrcode';
import { environment } from '../../../../environments/environment';
import { ProjectsService } from '../../../core/projects/projects.service';
import type { Build, BuildStatus, Project } from '../../../core/projects/project.models';
import { PlatformIcon } from '../../../shared/ui/platform-icon';

const ACTIVE_STATUSES: BuildStatus[] = ['queued', 'running'];
const POLL_INTERVAL_MS = 4000;

const STATUS_LABELS: Record<BuildStatus, string> = {
  queued: 'En attente',
  running: 'En cours',
  success: 'Succès',
  failed: 'Échec',
  cancelled: 'Annulé',
};

const STATUS_BADGE_CLASSES: Record<BuildStatus, string> = {
  queued: 'bg-amber-50 text-amber-700',
  running: 'bg-amber-50 text-amber-700',
  success: 'bg-green-50 text-green-700',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-neutral-100 text-neutral-500',
};

const MENU_ITEM_CLASS =
  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-600 disabled:opacity-50';
const MENU_WIDTH = 256;
const MENU_MAX_HEIGHT = 320;

@Component({
  selector: 'app-project-builds',
  imports: [RouterLink, PlatformIcon],
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
            Lancer un build
          </a>
        </div>

        @if (builds(); as list) {
          @if (list.length === 0) {
            <div class="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center">
              <p class="text-sm text-neutral-600">Aucun build lancé pour le moment.</p>
            </div>
          } @else {
            <div class="overflow-x-auto rounded-2xl border border-neutral-200 bg-white">
              <table class="w-full text-left text-sm">
                <caption class="sr-only">Historique des builds</caption>
                <thead class="border-b border-neutral-200 bg-neutral-50/70">
                  <tr>
                    <th scope="col" class="px-5 py-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                      Build
                    </th>
                    <th scope="col" class="px-5 py-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                      Statut
                    </th>
                    <th scope="col" class="px-5 py-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                      Plateforme
                    </th>
                    <th scope="col" class="px-5 py-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                      Branche / commit
                    </th>
                    <th scope="col" class="px-5 py-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                      Durée
                    </th>
                    <th scope="col" class="px-5 py-3"><span class="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-neutral-100">
                  @for (build of list; track build.id; let i = $index) {
                    <tr class="transition-colors hover:bg-neutral-50/80">
                      <td class="px-5 py-4 font-semibold text-neutral-900">#{{ list.length - i }}</td>
                      <td class="px-5 py-4">
                        <span
                          class="inline-flex items-center gap-1.5 rounded-full text-xs font-medium"
                          [class]="statusBadgeClasses[build.status]"
                        >
                          @switch (build.status) {
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
                              <svg
                                class="h-3.5 w-3.5 animate-spin"
                                viewBox="0 0 20 20"
                                fill="none"
                                aria-hidden="true"
                              >
                                <circle class="opacity-25" cx="10" cy="10" r="7" stroke="currentColor" stroke-width="3" />
                                <path
                                  d="M17 10a7 7 0 00-7-7"
                                  stroke="currentColor"
                                  stroke-width="3"
                                  stroke-linecap="round"
                                />
                              </svg>
                            }
                          }
                          <!-- {{ statusLabels[build.status] }} -->
                        </span>
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
                          [attr.aria-label]="'Actions pour le build ' + (list.length - i)"
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
                            alt="QR code d'installation iPhone pour ce build"
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
          <p role="status" class="text-sm text-neutral-500">Chargement des builds…</p>
        }
      } @else if (!errorMessage()) {
        <p role="status" class="text-sm text-neutral-500">Chargement…</p>
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
              Voir le run sur GitHub
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
              Télécharger l'artefact
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
                {{ installingIds().has(build.id) ? 'Préparation…' : 'Installer' }}
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
                    ? 'Préparation du lien…'
                    : 'Télécharger (hébergé MobileFlow)'
                }}
              </button>
              @if (build.platform === 'ios') {
                <a
                  role="menuitem"
                  class="${MENU_ITEM_CLASS}"
                  [href]="itmsServicesUrl(build.id)"
                  (click)="closeMenu()"
                >
                  Installer sur iPhone
                </a>
                <button
                  role="menuitem"
                  type="button"
                  class="${MENU_ITEM_CLASS}"
                  (click)="toggleQr(build.id); closeMenu()"
                >
                  {{ qrDataUrls().has(build.id) ? 'Masquer le QR code' : 'Afficher le QR code' }}
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
            {{ refreshingIds().has(build.id) ? 'Rafraîchissement…' : 'Rafraîchir' }}
          </button>
        </div>
      }
    </div>
  `,
})
export class ProjectBuilds implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly projectsService = inject(ProjectsService);

  protected readonly statusLabels = STATUS_LABELS;
  protected readonly statusBadgeClasses = STATUS_BADGE_CLASSES;
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
      this.errorMessage.set('Projet introuvable.');
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
      this.errorMessage.set('Impossible de charger l’historique des builds.');
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
      this.errorMessage.set('Impossible de rafraîchir ce build.');
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
      this.errorMessage.set('Impossible de récupérer le lien de téléchargement.');
    } finally {
      this.downloadingIds.update((ids) => {
        const next = new Set(ids);
        next.delete(buildId);
        return next;
      });
    }
  }

  // Hébergement à la demande : le binaire n'est extrait de l'archive GitHub et déposé sur
  // Firebase Storage que si l'utilisateur clique sur "Installer" (pas systématiquement à chaque
  // build), pour limiter le stockage utilisé aux builds staging réellement installés.
  protected async installBuild(buildId: string): Promise<void> {
    this.installingIds.update((ids) => new Set(ids).add(buildId));
    try {
      const updated = await this.projectsService.installBuild(this.projectId, buildId);
      this.builds.update((list) =>
        (list ?? []).map((build) => (build.id === buildId ? updated : build)),
      );
    } catch {
      this.errorMessage.set("Impossible de préparer l'installation de ce build.");
    } finally {
      this.installingIds.update((ids) => {
        const next = new Set(ids);
        next.delete(buildId);
        return next;
      });
    }
  }

  // Le Springboard iOS déclenche l'installation OTA en résolvant ce schéma d'URL, qui pointe
  // vers notre manifest.plist public (cf. PublicBuildsController côté API) — pas d'appel HTTP
  // direct possible ici, itms-services:// doit être ouvert depuis Safari sur l'iPhone lui-même.
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
      this.errorMessage.set('Impossible de générer le QR code.');
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
