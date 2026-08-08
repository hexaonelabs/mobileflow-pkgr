import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { GithubService } from '../../../core/github/github.service';
import { ProjectsService } from '../../../core/projects/projects.service';
import type { Environment, Platform, Project } from '../../../core/projects/project.models';

function atLeastOnePlatformValidator(control: AbstractControl): ValidationErrors | null {
  const { android, ios } = control.value as { android: boolean; ios: boolean };
  return android || ios ? null : { atLeastOnePlatform: true };
}

@Component({
  selector: 'app-project-build-new',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-8">
      @if (errorMessage()) {
        <p role="alert" class="text-sm text-red-600">{{ errorMessage() }}</p>
      }

      @if (project(); as project) {
        <div>
          <a class="text-sm underline" [routerLink]="['/projects', project.id]">← {{ project.name }}</a>
          <h1 class="text-2xl font-semibold">Nouveau build</h1>
        </div>

        <form class="flex flex-col gap-4" [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium" for="environment">Environnement</label>
            <select
              id="environment"
              formControlName="environment"
              class="rounded border border-gray-400 px-3 py-2"
            >
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium" for="branch">Branche</label>
            <select
              id="branch"
              formControlName="branch"
              class="rounded border border-gray-400 px-3 py-2 disabled:opacity-50"
              [attr.aria-invalid]="isBranchInvalid()"
            >
              <option value="" disabled>
                {{ branchesLoading() ? 'Chargement…' : 'Sélectionner une branche' }}
              </option>
              @for (branch of branches(); track branch) {
                <option [value]="branch">{{ branch }}</option>
              }
            </select>
            @if (isBranchInvalid()) {
              <p class="text-sm text-red-600" role="alert">La branche est requise.</p>
            }
          </div>

          <fieldset class="flex flex-col gap-1">
            <legend class="text-sm font-medium">Plateformes</legend>
            <label class="flex items-center gap-2">
              <input type="checkbox" formControlName="android" />
              Android
            </label>
            <label class="flex items-center gap-2">
              <input type="checkbox" formControlName="ios" />
              iOS
            </label>
            @if (form.invalid && form.touched) {
              <p class="text-sm text-red-600" role="alert">
                Au moins une plateforme doit être sélectionnée.
              </p>
            }
          </fieldset>

          <fieldset class="flex flex-col gap-2">
            <legend class="text-sm font-medium">Variables d'environnement</legend>
            @for (row of envVarRows(); track row.id; let i = $index) {
              <div class="flex items-center gap-2">
                <label class="sr-only" [attr.for]="'env-key-' + i">Clé</label>
                <input
                  [id]="'env-key-' + i"
                  type="text"
                  placeholder="Clé"
                  class="w-1/3 rounded border border-gray-400 px-3 py-2"
                  [value]="row.key"
                  (input)="updateEnvVarRow(i, 'key', $any($event.target).value)"
                />
                <label class="sr-only" [attr.for]="'env-value-' + i">Valeur</label>
                <input
                  [id]="'env-value-' + i"
                  type="text"
                  placeholder="Valeur"
                  class="flex-1 rounded border border-gray-400 px-3 py-2"
                  [value]="row.value"
                  (input)="updateEnvVarRow(i, 'value', $any($event.target).value)"
                />
                <button
                  type="button"
                  class="rounded border border-gray-400 px-2 py-1 text-sm"
                  (click)="removeEnvVarRow(i)"
                  [attr.aria-label]="'Supprimer la variable ' + (row.key || i)"
                >
                  Retirer
                </button>
              </div>
            }
            <button
              type="button"
              class="self-start rounded border border-gray-400 px-3 py-1 text-sm"
              (click)="addEnvVarRow()"
            >
              Ajouter une variable
            </button>
          </fieldset>

          @if (submitError()) {
            <p class="text-sm text-red-600" role="alert">{{ submitError() }}</p>
          }

          <button
            type="submit"
            class="rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
            [disabled]="form.invalid || submitting()"
          >
            {{ submitting() ? 'Lancement…' : 'Lancer le build' }}
          </button>
        </form>
      } @else if (!errorMessage()) {
        <p role="status">Chargement…</p>
      }
    </main>
  `,
})
export class ProjectBuildNew implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly githubService = inject(GithubService);
  private readonly projectsService = inject(ProjectsService);
  private readonly fb = inject(FormBuilder);

  protected readonly project = signal<Project | null>(null);
  protected readonly branches = signal<string[]>([]);
  protected readonly branchesLoading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly submitError = signal<string | null>(null);
  protected readonly submitting = signal(false);

  private envVarRowIdSeq = 0;
  protected readonly envVarRows = signal<{ id: number; key: string; value: string }[]>([]);

  protected readonly form = this.fb.nonNullable.group(
    {
      environment: this.fb.nonNullable.control<Environment>('staging', Validators.required),
      branch: ['', Validators.required],
      android: [false],
      ios: [false],
    },
    { validators: atLeastOnePlatformValidator },
  );

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.errorMessage.set('Projet introuvable.');
      return;
    }
    try {
      const project = await this.projectsService.get(id);
      this.project.set(project);
      this.branchesLoading.set(true);
      this.branches.set(await this.githubService.listBranches(project.githubRepoFullName));
    } catch {
      this.errorMessage.set('Impossible de charger ce projet.');
    } finally {
      this.branchesLoading.set(false);
    }
  }

  protected isBranchInvalid(): boolean {
    const control = this.form.controls.branch;
    return control.invalid && control.touched;
  }

  protected addEnvVarRow(): void {
    this.envVarRows.update((rows) => [...rows, { id: this.envVarRowIdSeq++, key: '', value: '' }]);
  }

  protected removeEnvVarRow(index: number): void {
    this.envVarRows.update((rows) => rows.filter((_, i) => i !== index));
  }

  protected updateEnvVarRow(index: number, field: 'key' | 'value', value: string): void {
    this.envVarRows.update((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const project = this.project();
    if (!project) {
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);
    const { environment, branch, android, ios } = this.form.getRawValue();
    const platforms: Platform[] = [
      ...(android ? (['android'] as const) : []),
      ...(ios ? (['ios'] as const) : []),
    ];
    const envVars = Object.fromEntries(
      this.envVarRows()
        .filter((row) => row.key.trim().length > 0)
        .map((row) => [row.key, row.value]),
    );

    try {
      await this.projectsService.createBuild(project.id, { environment, branch, platforms, envVars });
      await this.router.navigate(['/projects', project.id, 'builds']);
    } catch {
      this.submitError.set('Impossible de lancer ce build.');
    } finally {
      this.submitting.set(false);
    }
  }
}
