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
import { PlatformIcon } from '../../../shared/ui/platform-icon';

function atLeastOnePlatformValidator(control: AbstractControl): ValidationErrors | null {
  const { android, ios } = control.value as { android: boolean; ios: boolean };
  return android || ios ? null : { atLeastOnePlatform: true };
}

@Component({
  selector: 'app-project-build-new',
  imports: [ReactiveFormsModule, RouterLink, PlatformIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto flex max-w-xl flex-col gap-6">
      @if (errorMessage()) {
        <p role="alert" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {{ errorMessage() }}
        </p>
      }

      @if (project(); as project) {
        <div>
          <a
            class="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-neutral-500 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
            [routerLink]="['/projects', project.id, 'builds']"
          >
            ← Back to builds
          </a>
          <h2 class="mt-1 text-lg font-bold tracking-tight text-neutral-900">New build</h2>
        </div>

        <form
          class="flex flex-col gap-5 rounded-2xl border border-neutral-200 bg-white p-6"
          [formGroup]="form"
          (ngSubmit)="submit()"
          novalidate
        >
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium text-neutral-900" for="environment">Environment</label>
            <select
              id="environment"
              formControlName="environment"
              class="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600"
            >
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium text-neutral-900" for="branch">Branch</label>
            <select
              id="branch"
              formControlName="branch"
              class="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600 disabled:opacity-50"
              [attr.aria-invalid]="isBranchInvalid()"
            >
              <option value="" disabled>
                {{ branchesLoading() ? 'Loading…' : 'Select a branch' }}
              </option>
              @for (branch of branches(); track branch) {
                <option [value]="branch">{{ branch }}</option>
              }
            </select>
            @if (isBranchInvalid()) {
              <p class="text-sm text-red-600" role="alert">Branch is required.</p>
            }
          </div>

          <fieldset class="flex flex-col gap-1">
            <legend class="text-sm font-medium text-neutral-900">Platforms</legend>
            <div class="mt-1 grid grid-cols-2 gap-3">
              <label
                class="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-neutral-200 p-4 text-center transition-colors has-[:checked]:border-accent-600 has-[:checked]:bg-accent-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-600 hover:border-neutral-300"
              >
                <input type="checkbox" formControlName="android" class="sr-only" />
                <app-platform-icon platform="android" size="lg" />
                <span class="text-sm font-medium text-neutral-900">Android</span>
              </label>
              <label
                class="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-neutral-200 p-4 text-center transition-colors has-[:checked]:border-accent-600 has-[:checked]:bg-accent-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-600 hover:border-neutral-300"
              >
                <input type="checkbox" formControlName="ios" class="sr-only" />
                <app-platform-icon platform="ios" size="lg" />
                <span class="text-sm font-medium text-neutral-900">iOS</span>
              </label>
            </div>
            @if (form.invalid && form.touched) {
              <p class="mt-1 text-sm text-red-600" role="alert">
                At least one platform must be selected.
              </p>
            }
          </fieldset>

          <fieldset class="flex flex-col gap-2">
            <legend class="text-sm font-medium text-neutral-900">Environment Variables</legend>
            @for (row of envVarRows(); track row.id; let i = $index) {
              <div class="flex items-center gap-2">
                <label class="sr-only" [attr.for]="'env-key-' + i">Key</label>
                <input
                  [id]="'env-key-' + i"
                  type="text"
                  placeholder="Key"
                  class="w-1/3 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600"
                  [value]="row.key"
                  (input)="updateEnvVarRow(i, 'key', $any($event.target).value)"
                />
                <label class="sr-only" [attr.for]="'env-value-' + i">Value</label>
                <input
                  [id]="'env-value-' + i"
                  type="text"
                  placeholder="Value"
                  class="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600"
                  [value]="row.value"
                  (input)="updateEnvVarRow(i, 'value', $any($event.target).value)"
                />
                <button
                  type="button"
                  class="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                  (click)="removeEnvVarRow(i)"
                  [attr.aria-label]="'Delete variable ' + (row.key || i)"
                >
                  Remove
                </button>
              </div>
            }
            <button
              type="button"
              class="self-start rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
              (click)="addEnvVarRow()"
            >
              Add a variable
            </button>
          </fieldset>

          @if (submitError()) {
            <p class="text-sm text-red-600" role="alert">{{ submitError() }}</p>
          }

          <button
            type="submit"
            class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
            [disabled]="form.invalid || submitting()"
          >
            {{ submitting() ? 'Launching…' : 'Start build' }}
          </button>
        </form>
      } @else if (!errorMessage()) {
        <p role="status" class="text-sm text-neutral-500">Chargement…</p>
      }
    </div>
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
      this.errorMessage.set('Project not found.');
      return;
    }
    try {
      const project = await this.projectsService.get(id);
      this.project.set(project);
      this.branchesLoading.set(true);
      this.branches.set(await this.githubService.listBranches(project.githubRepoFullName));
    } catch {
      this.errorMessage.set('Unable to load project.');
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
      this.submitError.set('Unable to start this build.');
    } finally {
      this.submitting.set(false);
    }
  }
}
