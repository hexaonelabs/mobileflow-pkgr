import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ProjectsService } from '../../../core/projects/projects.service';
import type { GeneratedIosCertificate, Project, Secret } from '../../../core/projects/project.models';
import { IosCertificateCryptoService } from './ios-certificate-crypto.service';

type WizardStep =
  | 'loading'
  | 'apple-key'
  | 'ready'
  | 'generating-csr'
  | 'signing'
  | 'building-p12'
  | 'done'
  | 'error';

const STEP_LABELS: Record<Exclude<WizardStep, 'loading' | 'error'>, string> = {
  'apple-key': 'Connect your Apple Developer account',
  ready: 'Name your certificate',
  'generating-csr': 'Preparing your certificate',
  signing: 'Signing with Apple',
  'building-p12': 'Finishing up',
  done: 'Certificate ready',
};

const PROGRESS_STEPS: Array<{ key: Exclude<WizardStep, 'loading' | 'error'>; label: string }> = [
  { key: 'apple-key', label: 'Apple account' },
  { key: 'ready', label: 'Name' },
  { key: 'generating-csr', label: 'Generate' },
  { key: 'done', label: 'Done' },
];

function progressIndexFor(step: WizardStep): number {
  switch (step) {
    case 'apple-key':
      return 0;
    case 'ready':
      return 1;
    case 'generating-csr':
    case 'signing':
    case 'building-p12':
      return 2;
    case 'done':
      return 3;
    default:
      return 0;
  }
}

@Component({
  selector: 'app-ios-certificate-wizard',
  imports: [ReactiveFormsModule, RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto flex max-w-xl flex-col gap-6">
      <div aria-live="polite" class="sr-only">{{ announcement() }}</div>

      @if (project(); as project) {
        <div>
          <a
            class="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-neutral-500 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
            [routerLink]="['/projects', project.id, 'secrets']"
          >
            ← Back to secrets
          </a>
          <h2 class="mt-1 text-lg font-bold tracking-tight text-neutral-900">
            Generate an Apple Distribution certificate
          </h2>
          <p class="mt-1 text-sm text-neutral-600">
            MobileFlow generates and signs your certificate automatically — no macOS, no Keychain
            Access.
          </p>
        </div>

        @if (step() !== 'error') {
          <ol class="flex items-center gap-2 text-xs font-medium text-neutral-500" aria-label="Progress">
            @for (progressStep of progressSteps; track progressStep.key; let i = $index) {
              <li
                class="flex items-center gap-2"
                [attr.aria-current]="progressIndex() === i ? 'step' : null"
              >
                <span
                  class="flex h-5 w-5 items-center justify-center rounded-full text-[11px]"
                  [class]="
                    progressIndex() > i
                      ? 'bg-accent-600 text-white'
                      : progressIndex() === i
                        ? 'bg-accent-100 text-accent-700 ring-2 ring-accent-600'
                        : 'bg-neutral-100 text-neutral-400'
                  "
                >
                  {{ i + 1 }}
                </span>
                <span [class]="progressIndex() === i ? 'text-neutral-900' : ''">{{
                  progressStep.label
                }}</span>
                @if (i < progressSteps.length - 1) {
                  <span class="text-neutral-300">—</span>
                }
              </li>
            }
          </ol>
        }

        <section class="rounded-2xl border border-neutral-200 bg-white p-6">
          @switch (step()) {
            @case ('loading') {
              <p role="status" class="text-sm text-neutral-500">Loading…</p>
            }

            @case ('apple-key') {
              <h3 #stepHeading tabindex="-1" class="text-sm font-semibold text-neutral-900">
                Step 1 of 2 — Connect your Apple Developer account
              </h3>
              <p class="mt-2 text-sm text-neutral-600">
                This is a one-time setup per Apple account. Create an App Store Connect API key at
                <a
                  href="https://appstoreconnect.apple.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="font-medium text-accent-700 underline hover:text-accent-800"
                  >appstoreconnect.apple.com</a
                >
                → Users and Access → Integrations → App Store Connect API → Generate API Key (any role
                with certificate management, e.g. "Developer" or "Admin"). Download the resulting
                <code class="rounded bg-neutral-100 px-1 py-0.5 text-xs">.p8</code> file — Apple only lets
                you download it once.
              </p>

              <form
                class="mt-4 flex flex-col gap-4"
                [formGroup]="appleKeyForm"
                (ngSubmit)="submitAppleKey()"
                novalidate
              >
                <div class="flex flex-col gap-1">
                  <label class="text-sm font-medium text-neutral-900" for="issuerId">Issuer ID</label>
                  <input
                    id="issuerId"
                    type="text"
                    formControlName="issuerId"
                    class="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600"
                    [attr.aria-invalid]="isAppleKeyFieldInvalid('issuerId')"
                  />
                  @if (isAppleKeyFieldInvalid('issuerId')) {
                    <p class="text-sm text-red-600" role="alert">Issuer ID is required.</p>
                  }
                </div>

                <div class="flex flex-col gap-1">
                  <label class="text-sm font-medium text-neutral-900" for="keyId">Key ID</label>
                  <input
                    id="keyId"
                    type="text"
                    formControlName="keyId"
                    class="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600"
                    [attr.aria-invalid]="isAppleKeyFieldInvalid('keyId')"
                  />
                  @if (isAppleKeyFieldInvalid('keyId')) {
                    <p class="text-sm text-red-600" role="alert">Key ID is required.</p>
                  }
                </div>

                <div class="flex flex-col gap-1">
                  <label class="text-sm font-medium text-neutral-900" for="p8File">API key file (.p8)</label>
                  <input
                    id="p8File"
                    #p8FileInput
                    type="file"
                    accept=".p8"
                    class="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600"
                    (change)="onP8FileChange($event)"
                  />
                  @if (appleKeySubmitted() && !selectedP8File()) {
                    <p class="text-sm text-red-600" role="alert">The .p8 file is required.</p>
                  }
                </div>

                @if (appleKeyError()) {
                  <p class="text-sm text-red-600" role="alert">{{ appleKeyError() }}</p>
                }

                <button
                  type="submit"
                  class="self-start rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                  [disabled]="savingAppleKey()"
                >
                  {{ savingAppleKey() ? 'Saving…' : 'Save and continue' }}
                </button>
              </form>
            }

            @case ('ready') {
              <h3 #stepHeading tabindex="-1" class="text-sm font-semibold text-neutral-900">
                Step 2 of 2 — Name your certificate
              </h3>
              <p class="mt-2 text-sm text-neutral-600">
                MobileFlow will generate a signing key, request a certificate from Apple, and install it
                on this project automatically.
              </p>

              <form
                class="mt-4 flex flex-col gap-4"
                [formGroup]="nameForm"
                (ngSubmit)="generateCertificate()"
                novalidate
              >
                <div class="flex flex-col gap-1">
                  <label class="text-sm font-medium text-neutral-900" for="commonName">
                    Certificate name
                  </label>
                  <input
                    id="commonName"
                    type="text"
                    formControlName="commonName"
                    class="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600"
                  />
                </div>

                <button
                  type="submit"
                  class="self-start rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                >
                  Generate certificate
                </button>
              </form>
            }

            @case ('generating-csr') {
              <h3 #stepHeading tabindex="-1" class="text-sm font-semibold text-neutral-900">
                {{ stepLabel() }}
              </h3>
              <p role="status" class="mt-2 text-sm text-neutral-600">Generating your signing key…</p>
            }

            @case ('signing') {
              <h3 #stepHeading tabindex="-1" class="text-sm font-semibold text-neutral-900">
                {{ stepLabel() }}
              </h3>
              <p role="status" class="mt-2 text-sm text-neutral-600">
                Requesting your certificate from Apple…
              </p>
            }

            @case ('building-p12') {
              <h3 #stepHeading tabindex="-1" class="text-sm font-semibold text-neutral-900">
                {{ stepLabel() }}
              </h3>
              <p role="status" class="mt-2 text-sm text-neutral-600">
                Installing your certificate on this project…
              </p>
            }

            @case ('done') {
              <h3 #stepHeading tabindex="-1" class="text-sm font-semibold text-neutral-900">
                Your certificate is ready
              </h3>
              <p class="mt-2 text-sm text-neutral-600">
                It's installed on this project and ready to sign your next iOS build.
              </p>
              @if (generatedCertificate(); as cert) {
                <dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt class="text-neutral-500">Serial number</dt>
                  <dd class="text-neutral-900">{{ cert.serialNumber }}</dd>
                  <dt class="text-neutral-500">Expires</dt>
                  <dd class="text-neutral-900">{{ cert.expirationDate | date: 'mediumDate' }}</dd>
                </dl>
              }
              @if (backupDownloadUrl(); as url) {
                <a
                  [href]="url"
                  [download]="backupFileName()"
                  class="mt-4 inline-flex items-center gap-1 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                >
                  Download a backup copy (.p12)
                </a>
                <p class="mt-2 text-xs text-neutral-500">
                  This is your only chance to save a local copy — MobileFlow doesn't display it again
                  after you leave this page.
                </p>
              }
              <a
                [routerLink]="['/projects', project.id, 'secrets']"
                class="mt-4 inline-flex self-start rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
              >
                Done
              </a>
            }

            @case ('error') {
              <h3 #stepHeading tabindex="-1" class="text-sm font-semibold text-neutral-900">
                Something went wrong
              </h3>
              <p role="alert" class="mt-2 text-sm text-red-600">{{ errorMessage() }}</p>
              <button
                type="button"
                class="mt-4 self-start rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                (click)="retry()"
              >
                Try again
              </button>
            }
          }
        </section>
      } @else if (loadError()) {
        <p role="alert" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {{ loadError() }}
        </p>
      } @else {
        <p role="status" class="text-sm text-neutral-500">Loading…</p>
      }
    </div>
  `,
})
export class IosCertificateWizard implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly projectsService = inject(ProjectsService);
  private readonly crypto = inject(IosCertificateCryptoService);
  private readonly fb = inject(FormBuilder);

  protected readonly progressSteps = PROGRESS_STEPS;

  protected readonly project = signal<Project | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly step = signal<WizardStep>('loading');
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly generatedCertificate = signal<GeneratedIosCertificate | null>(null);
  protected readonly backupDownloadUrl = signal<string | null>(null);
  protected readonly backupFileName = signal<string>('apple-distribution.p12');

  protected readonly appleKeySubmitted = signal(false);
  protected readonly savingAppleKey = signal(false);
  protected readonly appleKeyError = signal<string | null>(null);
  protected readonly selectedP8File = signal<{ name: string; base64: string } | null>(null);
  private readonly stepHeadingRef = viewChild<ElementRef<HTMLElement>>('stepHeading');

  protected readonly appleKeyForm = this.fb.nonNullable.group({
    issuerId: ['', Validators.required],
    keyId: ['', Validators.required],
  });

  protected readonly nameForm = this.fb.nonNullable.group({
    commonName: ['', Validators.required],
  });

  protected readonly progressIndex = computed(() => progressIndexFor(this.step()));
  protected readonly stepLabel = computed(() => {
    const current = this.step();
    return current === 'loading' || current === 'error' ? '' : STEP_LABELS[current];
  });
  protected readonly announcement = computed(() => {
    const label = this.stepLabel();
    return label ? `Step: ${label}` : '';
  });

  // Clé RSA générée côté navigateur, jamais persistée ni envoyée au backend — uniquement la
  // CSR (info publique) l'est. Effacée dès que le .p12 a été construit avec succès.
  private keyPair: CryptoKeyPair | null = null;
  private projectId = '';

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loadError.set('Project not found.');
      return;
    }
    this.projectId = id;
    try {
      const [project, secrets] = await Promise.all([
        this.projectsService.get(id),
        this.projectsService.listSecrets(id),
      ]);
      this.project.set(project);
      this.nameForm.controls.commonName.setValue(project.name);
      this.backupFileName.set(`${project.name || 'apple-distribution'}.p12`);
      const hasAppleKey = secrets.some((secret: Secret) => secret.type === 'app_store_connect_key');
      this.step.set(hasAppleKey ? 'ready' : 'apple-key');
      this.focusStepHeading();
    } catch {
      this.loadError.set('Unable to load project.');
    }
  }

  ngOnDestroy(): void {
    const url = this.backupDownloadUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
  }

  protected isAppleKeyFieldInvalid(field: 'issuerId' | 'keyId'): boolean {
    const control = this.appleKeyForm.controls[field];
    return control.invalid && (control.touched || this.appleKeySubmitted());
  }

  protected async onP8FileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      this.selectedP8File.set(null);
      return;
    }
    const base64 = await this.readFileAsBase64(file);
    this.selectedP8File.set({ name: file.name, base64 });
  }

  protected async submitAppleKey(): Promise<void> {
    this.appleKeySubmitted.set(true);
    const file = this.selectedP8File();
    if (this.appleKeyForm.invalid || !file) {
      this.appleKeyForm.markAllAsTouched();
      return;
    }

    this.savingAppleKey.set(true);
    this.appleKeyError.set(null);
    const { issuerId, keyId } = this.appleKeyForm.getRawValue();

    try {
      await this.projectsService.createSecret(this.projectId, {
        type: 'app_store_connect_key',
        fileName: file.name,
        fileBase64: file.base64,
        issuerId,
        keyId,
      });
      this.step.set('ready');
      this.focusStepHeading();
    } catch (err) {
      this.appleKeyError.set(this.extractErrorMessage(err, 'Unable to save this Apple API key.'));
    } finally {
      this.savingAppleKey.set(false);
    }
  }

  protected async generateCertificate(): Promise<void> {
    if (this.nameForm.invalid) {
      this.nameForm.markAllAsTouched();
      return;
    }
    const { commonName } = this.nameForm.getRawValue();

    try {
      this.step.set('generating-csr');
      this.focusStepHeading();
      this.keyPair = await this.crypto.generateKeyPair();
      const csrPem = await this.crypto.createCertificateSigningRequest(this.keyPair, commonName);

      this.step.set('signing');
      this.focusStepHeading();
      const certificate = await this.projectsService.generateIosCertificate(this.projectId, { csrPem });
      this.generatedCertificate.set(certificate);

      this.step.set('building-p12');
      this.focusStepHeading();
      const password = this.crypto.generateRandomPassword();
      const p12Base64 = await this.crypto.buildPkcs12(
        this.keyPair,
        certificate.certificateContentBase64,
        password,
      );
      const fileName = `${commonName || 'apple-distribution'}.p12`;
      await this.projectsService.createSecret(this.projectId, {
        type: 'ios_certificate',
        fileName,
        fileBase64: p12Base64,
        password,
      });
      this.backupFileName.set(fileName);
      this.backupDownloadUrl.set(this.toDownloadUrl(p12Base64));

      this.step.set('done');
      this.focusStepHeading();
    } catch (err) {
      this.errorMessage.set(
        this.extractErrorMessage(err, 'Unable to generate this certificate. Please try again.'),
      );
      this.step.set('error');
      this.focusStepHeading();
    } finally {
      // La clé privée en mémoire n'est plus nécessaire une fois le .p12 construit (ou en cas
      // d'échec définitif) — nettoyage systématique, backup déjà proposé à l'étape 'done'.
      this.keyPair = null;
    }
  }

  protected retry(): void {
    this.errorMessage.set(null);
    this.step.set('ready');
    this.focusStepHeading();
  }

  private toDownloadUrl(base64: string): string {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'application/x-pkcs12' });
    return URL.createObjectURL(blob);
  }

  private focusStepHeading(): void {
    setTimeout(() => this.stepHeadingRef()?.nativeElement.focus());
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

  private extractErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const message = (err.error as { message?: string } | undefined)?.message;
      if (message) return message;
    }
    return fallback;
  }
}
