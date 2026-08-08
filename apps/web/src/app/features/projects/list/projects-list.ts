import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProjectsService } from '../../../core/projects/projects.service';
import type { Project } from '../../../core/projects/project.models';

@Component({
  selector: 'app-projects-list',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-8">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-semibold">Projets</h1>
        <a class="rounded bg-gray-900 px-4 py-2 text-white" routerLink="/github/connect">
          Activer un dépôt
        </a>
      </div>

      @if (errorMessage()) {
        <p role="alert" class="text-sm text-red-600">{{ errorMessage() }}</p>
      } @else if (projects(); as list) {
        @if (list.length === 0) {
          <p>Aucun projet pour le moment.</p>
        } @else {
          <ul class="flex flex-col gap-2">
            @for (project of list; track project.id) {
              <li class="rounded border border-gray-300 p-4">
                <a class="flex flex-col gap-1" [routerLink]="['/projects', project.id]">
                  <span class="font-medium">{{ project.name }}</span>
                  <span class="text-sm text-gray-600">{{ project.githubRepoFullName }}</span>
                </a>
              </li>
            }
          </ul>
        }
      } @else {
        <p role="status">Chargement des projets…</p>
      }
    </main>
  `,
})
export class ProjectsList implements OnInit {
  private readonly projectsService = inject(ProjectsService);

  protected readonly projects = signal<Project[] | null>(null);
  protected readonly errorMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.projects.set(await this.projectsService.list());
    } catch {
      this.errorMessage.set('Impossible de charger les projets.');
    }
  }
}
