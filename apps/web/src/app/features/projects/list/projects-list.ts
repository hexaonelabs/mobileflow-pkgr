import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProjectsService } from '../../../core/projects/projects.service';
import type { Project } from '../../../core/projects/project.models';

const AVATAR_COLORS = [
  'bg-indigo-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-violet-500',
];

@Component({
  selector: 'app-projects-list',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto flex max-w-3xl flex-col gap-6">
      <div class="flex items-center justify-between gap-4">
        <h1 class="text-2xl font-bold tracking-tight text-neutral-900">Projets</h1>
        <a
          class="inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
          routerLink="/github/connect"
        >
          Activer un dépôt
        </a>
      </div>

      @if (errorMessage()) {
        <p role="alert" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {{ errorMessage() }}
        </p>
      } @else if (projects(); as list) {
        @if (list.length === 0) {
          <div class="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center">
            <p class="text-sm text-neutral-600">Aucun projet pour le moment.</p>
          </div>
        } @else {
          <div class="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm ring-1 ring-neutral-900/5">
            <ul class="divide-y divide-neutral-100">
              @for (project of list; track project.id) {
                <li>
                  <a
                    class="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-600"
                    [routerLink]="['/projects', project.id]"
                  >
                    <span
                      class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white"
                      [class]="avatarClass(project.name)"
                      aria-hidden="true"
                    >
                      {{ initials(project.name) }}
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-semibold text-neutral-900">{{
                        project.name
                      }}</span>
                      <span class="block truncate text-xs text-neutral-500">{{
                        project.githubRepoFullName
                      }}</span>
                    </span>
                    <svg
                      aria-hidden="true"
                      class="h-5 w-5 shrink-0 text-neutral-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </a>
                </li>
              }
            </ul>
          </div>
        }
      } @else {
        <p role="status" class="text-sm text-neutral-500">Chargement des projets…</p>
      }
    </div>
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

  protected initials(name: string): string {
    return name.trim().slice(0, 2).toUpperCase();
  }

  protected avatarClass(name: string): string {
    const index = name.charCodeAt(0) % AVATAR_COLORS.length;
    return AVATAR_COLORS[index];
  }
}
