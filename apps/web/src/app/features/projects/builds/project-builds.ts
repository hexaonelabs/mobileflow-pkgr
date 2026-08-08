import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ProjectsService } from '../../../core/projects/projects.service';
import type { Build, Project } from '../../../core/projects/project.models';

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
                  <p class="font-medium">
                    {{ build.environment }} — {{ build.platform }} — {{ build.branch }}
                  </p>
                  <p class="text-sm text-gray-600">
                    Statut : {{ build.status }} — commit {{ build.commitSha.slice(0, 7) }}
                  </p>
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
export class ProjectBuilds implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly projectsService = inject(ProjectsService);

  protected readonly project = signal<Project | null>(null);
  protected readonly builds = signal<Build[] | null>(null);
  protected readonly errorMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.errorMessage.set('Projet introuvable.');
      return;
    }
    try {
      const [project, builds] = await Promise.all([
        this.projectsService.get(id),
        this.projectsService.listBuilds(id),
      ]);
      this.project.set(project);
      this.builds.set(builds);
    } catch {
      this.errorMessage.set('Impossible de charger l’historique des builds.');
    }
  }
}
