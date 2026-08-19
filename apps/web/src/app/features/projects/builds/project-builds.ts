import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import QRCode from 'qrcode';
import { environment } from '../../../../environments/environment';
import { ProjectsService } from '../../../core/projects/projects.service';
import type { Build, BuildStatus, Project } from '../../../core/projects/project.models';

const ACTIVE_STATUSES: BuildStatus[] = ['queued', 'running'];
const POLL_INTERVAL_MS = 4000;

const STATUS_LABELS: Record<BuildStatus, string> = {
  queued: 'En attente',
  running: 'En cours',
  success: 'Succès',
  failed: 'Échec',
  cancelled: 'Annulé',
};

@Component({
  selector: 'app-project-builds',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-8">
      @if (errorMessage()) {
        <p role="alert" class="text-sm text-red-600">{{ errorMessage() }}</p>
      }

      @if (project(); as project) {
        <div class="flex items-center justify-between">
          <div>
            <a class="text-sm underline" [routerLink]="['/projects', project.id]">← {{ project.name }}</a>
            <h1 class="text-2xl font-semibold">Historique des builds</h1>
          </div>
          <a
            class="rounded bg-gray-900 px-4 py-2 text-white"
            [routerLink]="['/projects', project.id, 'builds', 'new']"
          >
            Lancer un build
          </a>
        </div>

        @if (builds(); as list) {
          @if (list.length === 0) {
            <p>Aucun build lancé pour le moment.</p>
          } @else {
            <ul class="flex flex-col gap-2">
              @for (build of list; track build.id) {
                <li class="rounded border border-gray-300 p-4">
                  <div class="flex items-start justify-between gap-4">
                    <div>
                      <p class="font-medium">
                        {{ build.environment }} — {{ build.platform }} — {{ build.branch }}
                      </p>
                      <p class="text-sm text-gray-600">
                        Statut : {{ statusLabels[build.status] }} — commit {{ build.commitSha.slice(0, 7) }}
                        @if (build.durationSeconds !== null) {
                          — {{ build.durationSeconds }}s
                        }
                      </p>
                      <div class="flex flex-wrap gap-3">
                        @if (build.logsUrl) {
                          <a
                            class="text-sm underline"
                            [href]="build.logsUrl"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Voir le run sur GitHub
                          </a>
                        }
                        @if (build.artifactUrl) {
                          <a
                            class="text-sm font-medium text-green-700 underline"
                            [href]="build.artifactUrl"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Télécharger l'artefact
                          </a>
                        }
                        @if (build.environment === 'staging' && build.status === 'success') {
                          @if (!build.artifactStoragePath) {
                            <button
                              type="button"
                              class="text-sm font-medium text-blue-700 underline disabled:opacity-50"
                              [disabled]="installingIds().has(build.id)"
                              (click)="installBuild(build.id)"
                            >
                              {{ installingIds().has(build.id) ? 'Préparation…' : 'Installer' }}
                            </button>
                          } @else {
                            <button
                              type="button"
                              class="text-sm underline disabled:opacity-50"
                              [disabled]="downloadingIds().has(build.id)"
                              (click)="downloadArtifact(build.id)"
                            >
                              {{
                                downloadingIds().has(build.id)
                                  ? 'Préparation du lien…'
                                  : 'Télécharger (hébergé MobileFlow)'
                              }}
                            </button>
                            @if (build.platform === 'ios') {
                              <a
                                class="text-sm font-medium text-blue-700 underline"
                                [href]="itmsServicesUrl(build.id)"
                              >
                                Installer sur iPhone
                              </a>
                              <button
                                type="button"
                                class="text-sm underline"
                                (click)="toggleQr(build.id)"
                              >
                                {{
                                  qrDataUrls().has(build.id)
                                    ? 'Masquer le QR code'
                                    : 'Afficher le QR code'
                                }}
                              </button>
                            }
                          }
                        }
                      </div>
                      @if (qrDataUrls().has(build.id)) {
                        <img
                          [src]="qrDataUrls().get(build.id)"
                          alt="QR code d'installation iPhone pour ce build"
                          width="180"
                          height="180"
                          class="mt-2 rounded border border-gray-200"
                        />
                      }
                    </div>
                    <button
                      type="button"
                      class="shrink-0 rounded border border-gray-400 px-3 py-1 text-sm disabled:opacity-50"
                      [disabled]="refreshingIds().has(build.id)"
                      (click)="refresh(build.id)"
                    >
                      {{ refreshingIds().has(build.id) ? 'Rafraîchissement…' : 'Rafraîchir' }}
                    </button>
                  </div>
                </li>
              }
            </ul>
          }
        } @else if (!errorMessage()) {
          <p role="status">Chargement des builds…</p>
        }
      } @else if (!errorMessage()) {
        <p role="status">Chargement…</p>
      }
    </main>
  `,
})
export class ProjectBuilds implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly projectsService = inject(ProjectsService);

  protected readonly statusLabels = STATUS_LABELS;
  protected readonly project = signal<Project | null>(null);
  protected readonly builds = signal<Build[] | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly refreshingIds = signal<Set<string>>(new Set());
  protected readonly downloadingIds = signal<Set<string>>(new Set());
  protected readonly installingIds = signal<Set<string>>(new Set());
  protected readonly qrDataUrls = signal<Map<string, string>>(new Map());

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
