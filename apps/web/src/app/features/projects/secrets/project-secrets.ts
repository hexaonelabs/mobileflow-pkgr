import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ProjectsService } from '../../../core/projects/projects.service';
import type {
  Environment,
  Project,
  Secret,
  SecretType,
} from '../../../core/projects/project.models';

function aliasRequiredForAndroidValidator(control: AbstractControl): ValidationErrors | null {
  const { type, alias } = control.value as { type: SecretType; alias: string };
  return type === 'android_keystore' && !alias.trim() ? { aliasRequired: true } : null;
}

// A provisioning profile (.mobileprovision) is not password protected.
function passwordRequiredValidator(control: AbstractControl): ValidationErrors | null {
  const { type, password } = control.value as { type: SecretType; password: string };
  return type !== 'ios_provisioning_profile' && !password.trim() ? { passwordRequired: true } : null;
}

function environmentRequiredForProvisioningProfileValidator(
  control: AbstractControl,
): ValidationErrors | null {
  const { type, environment } = control.value as { type: SecretType; environment: string };
  return type === 'ios_provisioning_profile' && !environment ? { environmentRequired: true } : null;
}

const SECRET_TYPE_LABELS: Record<SecretType, string> = {
  ios_certificate: 'iOS Certificate (.p12)',
  ios_provisioning_profile: 'iOS Provisioning Profile (.mobileprovision)',
  android_keystore: 'Android Keystore',
};

const ENVIRONMENT_LABELS: Record<Environment, string> = {
  staging: 'Staging (Ad Hoc)',
  production: 'Production (App Store)',
};

@Component({
  selector: 'app-project-secrets',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      @if (errorMessage()) {
        <p role="alert" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {{ errorMessage() }}
        </p>
      }

      @if (project(); as project) {
        <div>
          <h2 class="text-lg font-bold tracking-tight text-neutral-900">Secret Vault</h2>
          <p class="mt-1 text-sm text-neutral-600">
            iOS signing certificates and Android keystores. Content is encrypted at rest and never re-displayed after upload.
          </p>
        </div>

        <section class="rounded-2xl border border-neutral-200 bg-white">
          <h3 class="border-b border-neutral-200 px-5 py-4 text-sm font-semibold text-neutral-900">
            Stored Secrets
          </h3>
          @if (secrets(); as list) {
            @if (list.length === 0) {
              <p class="px-5 py-8 text-center text-sm text-neutral-600">
                No secrets stored yet.
              </p>
            } @else {
              <ul class="divide-y divide-neutral-100">
                @for (secret of list; track secret.id) {
                  <li class="flex items-center justify-between gap-4 px-5 py-4">
                    <div class="min-w-0">
                      <p class="truncate text-sm font-medium text-neutral-900">
                        {{ secretLabel(secret) }}
                      </p>
                      <p class="truncate text-xs text-neutral-500">{{ secret.fileName }}</p>
                    </div>
                    <button
                      type="button"
                      class="shrink-0 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                      (click)="removeSecret(secret)"
                      [attr.aria-label]="'Delete ' + secretLabel(secret)"
                    >
                      Delete
                    </button>
                  </li>
                }
              </ul>
            }
          } @else if (!errorMessage()) {
            <p role="status" class="px-5 py-8 text-center text-sm text-neutral-500">
              Loading secrets…
            </p>
          }
        </section>

        <section class="rounded-2xl border border-neutral-200 bg-white p-6">
          <h3 class="text-sm font-semibold text-neutral-900">Add a Secret</h3>
          <form class="mt-4 flex flex-col gap-4" [formGroup]="form" (ngSubmit)="submit()" novalidate>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-neutral-900" for="type">Type</label>
              <select
                id="type"
                formControlName="type"
                class="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600"
              >
                <option value="ios_certificate">Certificat iOS (.p12)</option>
                <option value="ios_provisioning_profile">Provisioning profile iOS (.mobileprovision)</option>
                <option value="android_keystore">Keystore Android</option>
              </select>
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium text-neutral-900" for="file">File</label>
              <input
                id="file"
                #fileInput
                type="file"
                [accept]="fileAccept()"
                class="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600"
                (change)="onFileChange($event)"
              />
              @if (submitted() && !selectedFile()) {
                <p class="text-sm text-red-600" role="alert">A file is required.</p>
              }
            </div>

            @if (selectedType() === 'ios_provisioning_profile') {
              <div class="flex flex-col gap-1">
                <label class="text-sm font-medium text-neutral-900" for="environment">Environment</label>
                <select
                  id="environment"
                  formControlName="environment"
                  class="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600"
                  [attr.aria-invalid]="isEnvironmentInvalid()"
                >
                  <option value="" disabled>Select an environment</option>
                  <option value="staging">Staging (Ad Hoc)</option>
                  <option value="production">Production (App Store)</option>
                </select>
                @if (isEnvironmentInvalid()) {
                  <p class="text-sm text-red-600" role="alert">Environment is required.</p>
                }
              </div>
            }

            @if (selectedType() !== 'ios_provisioning_profile') {
              <div class="flex flex-col gap-1">
                <label class="text-sm font-medium text-neutral-900" for="password">
                  {{ selectedType() === 'android_keystore' ? 'Keystore password' : 'Certificate password' }}
                </label>
                <input
                  id="password"
                  type="password"
                  formControlName="password"
                  class="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600"
                  [attr.aria-invalid]="isPasswordInvalid()"
                />
                @if (isPasswordInvalid()) {
                  <p class="text-sm text-red-600" role="alert">Password is required.</p>
                }
              </div>
            }

            @if (selectedType() === 'android_keystore') {
              <div class="flex flex-col gap-1">
                <label class="text-sm font-medium text-neutral-900" for="alias">Key alias</label>
                <input
                  id="alias"
                  type="text"
                  formControlName="alias"
                  class="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600"
                  [attr.aria-invalid]="isAliasInvalid()"
                />
                @if (isAliasInvalid()) {
                  <p class="text-sm text-red-600" role="alert">Alias is required.</p>
                }
              </div>

              <div class="flex flex-col gap-1">
                <label class="text-sm font-medium text-neutral-900" for="keyPassword">
                  Key password (if different from keystore)
                </label>
                <input
                  id="keyPassword"
                  type="password"
                  formControlName="keyPassword"
                  class="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600"
                />
              </div>
            }

            @if (submitError()) {
              <p class="text-sm text-red-600" role="alert">{{ submitError() }}</p>
            }

            <button
              type="submit"
              class="self-start rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
              [disabled]="submitting()"
            >
              {{ submitting() ? 'Uploading…' : 'Save' }}
            </button>
          </form>
        </section>
      } @else if (!errorMessage()) {
        <p role="status" class="text-sm text-neutral-500">Loading…</p>
      }
    </div>
  `,
})
export class ProjectSecrets implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly projectsService = inject(ProjectsService);
  private readonly fb = inject(FormBuilder);

  protected readonly secretTypeLabels = SECRET_TYPE_LABELS;

  protected readonly project = signal<Project | null>(null);
  protected readonly secrets = signal<Secret[] | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly submitError = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly submitted = signal(false);
  protected readonly selectedFile = signal<{ name: string; base64: string } | null>(null);
  private readonly fileInputRef = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  protected readonly form = this.fb.nonNullable.group(
    {
      type: this.fb.nonNullable.control<SecretType>('ios_certificate', Validators.required),
      environment: this.fb.nonNullable.control<Environment | ''>(''),
      password: [''],
      alias: [''],
      keyPassword: [''],
    },
    {
      validators: [
        aliasRequiredForAndroidValidator,
        passwordRequiredValidator,
        environmentRequiredForProvisioningProfileValidator,
      ],
    },
  );

  private projectId = '';

  protected selectedType(): SecretType {
    return this.form.controls.type.value;
  }

  protected fileAccept(): string {
    switch (this.selectedType()) {
      case 'android_keystore':
        return '.jks,.keystore';
      case 'ios_provisioning_profile':
        return '.mobileprovision';
      default:
        return '.p12';
    }
  }

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.errorMessage.set('Project not found.');
      return;
    }
    this.projectId = id;
    try {
      const [project, secrets] = await Promise.all([
        this.projectsService.get(id),
        this.projectsService.listSecrets(id),
      ]);
      this.project.set(project);
      this.secrets.set(secrets);
    } catch {
      this.errorMessage.set('Unable to load project.');
    }
  }

  protected isPasswordInvalid(): boolean {
    return this.form.hasError('passwordRequired') && this.form.controls.password.touched;
  }

  protected isAliasInvalid(): boolean {
    return this.form.hasError('aliasRequired') && this.form.controls.alias.touched;
  }

  protected isEnvironmentInvalid(): boolean {
    return this.form.hasError('environmentRequired') && this.form.controls.environment.touched;
  }

  protected secretLabel(secret: Secret): string {
    const base = this.secretTypeLabels[secret.type];
    if (secret.type !== 'ios_provisioning_profile' || !secret.environment) {
      return base;
    }
    return `${base} — ${ENVIRONMENT_LABELS[secret.environment]}`;
  }

  protected async onFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      this.selectedFile.set(null);
      return;
    }
    const base64 = await this.readFileAsBase64(file);
    this.selectedFile.set({ name: file.name, base64 });
  }

  private readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1] ?? '');
      };
      reader.onerror = () => reject(reader.error as Error);
      reader.readAsDataURL(file);
    });
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    const file = this.selectedFile();
    if (this.form.invalid || !file) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);
    const { type, environment, password, alias, keyPassword } = this.form.getRawValue();

    try {
      const created = await this.projectsService.createSecret(this.projectId, {
        type,
        fileName: file.name,
        fileBase64: file.base64,
        environment: type === 'ios_provisioning_profile' ? (environment as Environment) : undefined,
        password: type === 'ios_provisioning_profile' ? undefined : password,
        alias: type === 'android_keystore' ? alias : undefined,
        keyPassword: keyPassword.trim() ? keyPassword : undefined,
      });
      this.secrets.update((list) => [
        created,
        ...(list ?? []).filter(
          (s) =>
            s.type !== type || (type === 'ios_provisioning_profile' && s.environment !== created.environment),
        ),
      ]);
      this.form.reset({ type, environment: '', password: '', alias: '', keyPassword: '' });
      this.selectedFile.set(null);
      this.submitted.set(false);
      const inputEl = this.fileInputRef()?.nativeElement;
      if (inputEl) {
        inputEl.value = '';
      }
    } catch {
      this.submitError.set('Unable to save this secret.');
    } finally {
      this.submitting.set(false);
    }
  }

  protected async removeSecret(secret: Secret): Promise<void> {
    try {
      await this.projectsService.removeSecret(this.projectId, secret.id);
      this.secrets.update((list) => (list ?? []).filter((s) => s.id !== secret.id));
    } catch {
      this.errorMessage.set('Unable to delete this secret.');
    }
  }
}
