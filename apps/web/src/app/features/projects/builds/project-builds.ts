import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
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
