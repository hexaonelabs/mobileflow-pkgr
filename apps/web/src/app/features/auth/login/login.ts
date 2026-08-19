import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { Logo } from '../../../shared/ui/logo';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 py-8">
      <div class="flex flex-col items-center gap-2 text-center">
        <app-logo class="h-9 w-9" />
        <h1 class="text-2xl font-bold tracking-tight text-neutral-900">Connexion</h1>
      </div>

      <div class="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <form class="flex flex-col gap-4" [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium text-neutral-900" for="email">Email</label>
            <input
              id="email"
              type="email"
              formControlName="email"
              autocomplete="email"
              class="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600"
              [attr.aria-invalid]="isInvalid('email')"
              [attr.aria-describedby]="isInvalid('email') ? 'email-error' : null"
            />
            @if (isInvalid('email')) {
              <p id="email-error" class="text-sm text-red-600" role="alert">
                Merci de saisir un email valide.
              </p>
            }
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium text-neutral-900" for="password">Mot de passe</label>
            <input
              id="password"
              type="password"
              formControlName="password"
              autocomplete="current-password"
              class="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600"
              [attr.aria-invalid]="isInvalid('password')"
              [attr.aria-describedby]="isInvalid('password') ? 'password-error' : null"
            />
            @if (isInvalid('password')) {
              <p id="password-error" class="text-sm text-red-600" role="alert">
                Mot de passe requis (8 caractères minimum).
              </p>
            }
          </div>

          @if (errorMessage()) {
            <p class="text-sm text-red-600" role="alert">{{ errorMessage() }}</p>
          }

          <button
            type="submit"
            class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
            [disabled]="form.invalid || submitting()"
          >
            {{ submitting() ? 'Connexion en cours…' : 'Se connecter' }}
          </button>
        </form>

        <div class="mt-4 flex items-center gap-3" aria-hidden="true">
          <span class="h-px flex-1 bg-neutral-200"></span>
          <span class="text-xs text-neutral-400">ou</span>
          <span class="h-px flex-1 bg-neutral-200"></span>
        </div>

        <div class="mt-4 flex flex-col gap-2">
          <button
            type="button"
            class="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
            (click)="authService.loginWithGoogle()"
          >
            Continuer avec Google
          </button>
          <button
            type="button"
            class="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
            (click)="authService.loginWithGithub()"
          >
            Continuer avec GitHub
          </button>
        </div>
      </div>

      <p class="text-center text-sm text-neutral-600">
        Pas encore de compte ?
        <a class="font-medium text-accent-600 hover:underline" routerLink="/auth/register">
          Créer un compte
        </a>
      </p>
    </main>
  `,
})
export class Login {
  protected readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  protected isInvalid(controlName: 'email' | 'password'): boolean {
    const control = this.form.controls[controlName];
    return control.invalid && control.touched;
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);
    const { email, password } = this.form.getRawValue();
    try {
      await this.authService.login(email, password);
      await this.router.navigateByUrl('/');
    } catch {
      this.errorMessage.set('Identifiants invalides.');
    } finally {
      this.submitting.set(false);
    }
  }
}
