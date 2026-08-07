import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4">
      <h1 class="text-2xl font-semibold">Connexion</h1>

      <form class="flex flex-col gap-4" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="email">Email</label>
          <input
            id="email"
            type="email"
            formControlName="email"
            autocomplete="email"
            class="rounded border border-gray-400 px-3 py-2"
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
          <label class="text-sm font-medium" for="password">Mot de passe</label>
          <input
            id="password"
            type="password"
            formControlName="password"
            autocomplete="current-password"
            class="rounded border border-gray-400 px-3 py-2"
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
          class="rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
          [disabled]="form.invalid || submitting()"
        >
          {{ submitting() ? 'Connexion en cours…' : 'Se connecter' }}
        </button>
      </form>

      <div class="flex flex-col gap-2">
        <button
          type="button"
          class="rounded border border-gray-400 px-4 py-2"
          (click)="authService.loginWithGoogle()"
        >
          Continuer avec Google
        </button>
        <button
          type="button"
          class="rounded border border-gray-400 px-4 py-2"
          (click)="authService.loginWithGithub()"
        >
          Continuer avec GitHub
        </button>
      </div>

      <p class="text-sm">
        Pas encore de compte ?
        <a class="underline" routerLink="/auth/register">Créer un compte</a>
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
