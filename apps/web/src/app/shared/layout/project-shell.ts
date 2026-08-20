import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ProjectsService } from '../../core/projects/projects.service';
import type { Project } from '../../core/projects/project.models';

const TAB_CLASS =
  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600';
const TAB_ACTIVE_CLASS = 'bg-accent-50 text-accent-700 hover:bg-accent-50 hover:text-accent-700';

@Component({
  selector: 'app-project-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-dvh flex-col bg-neutral-50 md:flex-row">
      <aside class="w-full shrink-0 border-b border-neutral-200 bg-white md:w-64 md:border-r md:border-b-0">
        <div class="px-5 py-4">
          <a
            routerLink="/projects"
            class="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-neutral-500 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
          >
            <svg aria-hidden="true" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Projets
          </a>

          @if (project(); as project) {
            <h1 class="mt-2 truncate text-lg font-bold tracking-tight text-neutral-900">
              {{ project.name }}
            </h1>
            <p class="truncate text-xs text-neutral-500">{{ project.githubRepoFullName }}</p>
          } @else if (errorMessage()) {
            <p role="alert" class="mt-2 text-xs text-red-600">{{ errorMessage() }}</p>
          } @else {
            <p role="status" class="mt-2 text-xs text-neutral-400">Chargement…</p>
          }
        </div>

        <nav aria-label="Sections du projet" class="flex flex-col gap-1 px-3 pb-4">
          <a
            [routerLink]="['/projects', projectId()]"
            [routerLinkActiveOptions]="{ exact: true }"
            routerLinkActive="${TAB_ACTIVE_CLASS}"
            class="${TAB_CLASS}"
          >
            Overview
          </a>
          <a
            [routerLink]="['/projects', projectId(), 'builds']"
            routerLinkActive="${TAB_ACTIVE_CLASS}"
            class="${TAB_CLASS}"
          >
            Builds
          </a>
          <a
            [routerLink]="['/projects', projectId(), 'secrets']"
            routerLinkActive="${TAB_ACTIVE_CLASS}"
            class="${TAB_CLASS}"
          >
            Secrets
          </a>
          <a
            [routerLink]="['/projects', projectId(), 'analytics']"
            routerLinkActive="${TAB_ACTIVE_CLASS}"
            class="${TAB_CLASS}"
          >
            Analytics
          </a>
        </nav>
      </aside>

      <main class="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <router-outlet />
      </main>
    </div>
  `,
})
export class ProjectShell implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly projectsService = inject(ProjectsService);

  protected readonly projectId = signal('');
  protected readonly project = signal<Project | null>(null);
  protected readonly errorMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.errorMessage.set('Projet introuvable.');
      return;
    }
    this.projectId.set(id);
    try {
      this.project.set(await this.projectsService.get(id));
    } catch {
      this.errorMessage.set('Impossible de charger ce projet.');
    }
  }
}
