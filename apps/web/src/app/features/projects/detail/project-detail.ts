import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProjectsService } from '../../../core/projects/projects.service';
import type { Project } from '../../../core/projects/project.models';

@Component({
  selector: 'app-project-detail',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-8">
      @if (errorMessage()) {
        <p role="alert" class="text-sm text-red-600">{{ errorMessage() }}</p>
      } @else if (project(); as project) {
        <div>
          <h1 class="text-2xl font-semibold">{{ project.name }}</h1>
          <p class="text-sm text-gray-600">{{ project.githubRepoFullName }}</p>
        </div>

        <nav class="flex flex-col gap-2" aria-label="Sections du projet">
          <a
            class="rounded bg-gray-900 px-4 py-2 text-center text-white"
            [routerLink]="['/projects', project.id, 'builds', 'new']"
          >
            Lancer un build
          </a>
          <a
            class="rounded border border-gray-400 px-4 py-2 text-center"
            [routerLink]="['/projects', project.id, 'builds']"
          >
            Historique des builds
          </a>
          <a
            class="rounded border border-gray-400 px-4 py-2 text-center"
            [routerLink]="['/projects', project.id, 'secrets']"
          >
            Secret Vault
          </a>
        </nav>

        <button
          type="button"
          class="self-start rounded border border-red-400 px-4 py-2 text-red-600"
          (click)="remove()"
        >
          Supprimer le projet
        </button>
      } @else {
        <p role="status">Chargement du projet…</p>
      }
    </main>
  `,
})
export class ProjectDetail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly projectsService = inject(ProjectsService);

  protected readonly project = signal<Project | null>(null);
  protected readonly errorMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.errorMessage.set('Projet introuvable.');
      return;
    }
    try {
      this.project.set(await this.projectsService.get(id));
    } catch {
      this.errorMessage.set('Impossible de charger ce projet.');
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
      this.errorMessage.set('Impossible de supprimer ce projet.');
    }
  }
}
