import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProjectsService } from '../../../core/projects/projects.service';
import type {
  Project,
  RepoReadiness,
  SetupTriggerResult,
} from '../../../core/projects/project.models';

@Component({
  selector: 'app-project-detail',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      @if (errorMessage()) {
        <p role="alert" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {{ errorMessage() }}
        </p>
      } @else if (project(); as project) {
        <div class="flex flex-wrap items-center justify-between gap-4">
          <h2 class="text-lg font-bold tracking-tight text-neutral-900">Vue d'ensemble</h2>
          <a
            class="inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
            [routerLink]="['/projects', project.id, 'builds', 'new']"
          >
            Lancer un build
          </a>
        </div>

        <section aria-labelledby="readiness-heading" class="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm ring-1 ring-neutral-900/5">
          <h3 id="readiness-heading" class="text-sm font-semibold text-neutral-900">Préparation du dépôt</h3>
          @if (readiness(); as readiness) {
            <ul class="mt-3 flex flex-col gap-2">
              <li class="flex items-center gap-2 text-sm">
                <span
                  class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  [class]="readiness.capacitorInstalled ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'"
                  aria-hidden="true"
                >
                  {{ readiness.capacitorInstalled ? '✓' : '!' }}
                </span>
                <span class="text-neutral-700">
                  Capacitor installé (@capacitor/core dans package.json)
                </span>
              </li>
              <li class="flex items-center gap-2 text-sm">
                <span
                  class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  [class]="readiness.androidPlatformAdded ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'"
                  aria-hidden="true"
                >
                  {{ readiness.androidPlatformAdded ? '✓' : '!' }}
                </span>
                <span class="text-neutral-700">Plateforme Android ajoutée (dossier android/)</span>
              </li>
              <li class="flex items-center gap-2 text-sm">
                <span
                  class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  [class]="readiness.iosPlatformAdded ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'"
                  aria-hidden="true"
                >
                  {{ readiness.iosPlatformAdded ? '✓' : '!' }}
                </span>
                <span class="text-neutral-700">Plateforme iOS ajoutée (dossier ios/)</span>
              </li>
            </ul>
            @if (!isFullyReady()) {
              <p class="mt-4 text-sm text-neutral-600">
                Pour que les builds compilent réellement, exécutez localement dans votre dépôt :
              </p>
              <pre class="mt-2 overflow-x-auto rounded-lg bg-neutral-900 p-3 text-xs text-neutral-100">{{ setupCommand() }}</pre>
              <p class="mt-2 text-sm text-neutral-600">puis committez et poussez les fichiers générés.</p>

              <div class="mt-4 flex flex-col gap-2">
                @if (!setupConfirming()) {
                  <button
                    type="button"
                    class="self-start rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                    (click)="setupConfirming.set(true)"
                  >
                    Configurer automatiquement
                  </button>
                } @else {
                  <div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
                    <p class="text-amber-900">
                      Ceci va pousser un commit dans votre dépôt GitHub ({{ project.githubRepoFullName }})
                      pour installer Capacitor et/ou ajouter les plateformes manquantes.
                    </p>
                    <div class="mt-3 flex flex-col gap-1">
                      <label class="text-sm font-medium text-neutral-900" for="web-dir">
                        Répertoire de build web (webDir)
                      </label>
                      <input
                        id="web-dir"
                        type="text"
                        class="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-600"
                        [value]="webDir()"
                        (input)="webDir.set($any($event.target).value)"
                      />
                      <p class="text-xs text-neutral-600">
                        Répertoire où votre commande de build (ex. <code>npm run build</code>) génère les
                        fichiers statiques. Par défaut "www", mais dépend de votre framework (ex. Angular :
                        dist/&lt;nom-projet&gt;/browser).
                      </p>
                    </div>
                    <div class="mt-3 flex gap-2">
                      <button
                        type="button"
                        class="rounded-lg bg-accent-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-accent-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                        [disabled]="settingUp()"
                        (click)="triggerSetup()"
                      >
                        {{ settingUp() ? 'Lancement…' : 'Confirmer' }}
                      </button>
                      <button
                        type="button"
                        class="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                        (click)="setupConfirming.set(false)"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                }
              </div>

              @if (setupResult(); as result) {
                <p class="mt-3 text-sm text-green-700">
                  Configuration lancée.
                  @if (result.htmlUrl) {
                    <a
                      class="underline underline-offset-2"
                      [href]="result.htmlUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Voir le run sur GitHub
                    </a>
                  }
                  — rafraîchissez cette page dans une minute pour voir le statut mis à jour.
                </p>
              }
              @if (setupError()) {
                <p role="alert" class="mt-3 text-sm text-red-600">{{ setupError() }}</p>
              }
            }
          } @else if (!readinessError()) {
            <p role="status" class="mt-3 text-sm text-neutral-500">Analyse du dépôt…</p>
          }
          @if (readinessError()) {
            <p role="alert" class="mt-3 text-sm text-red-600">{{ readinessError() }}</p>
          }
        </section>

        <section aria-labelledby="workflow-heading" class="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm ring-1 ring-neutral-900/5">
          <h3 id="workflow-heading" class="text-sm font-semibold text-neutral-900">Workflow de build</h3>
          <p class="mt-1 text-sm text-neutral-600">
            MobileFlow n'installe le workflow ({{ '.github/workflows/mobileflow.yml' }}) qu'une seule
            fois : vous pouvez ensuite le personnaliser librement, il ne sera plus jamais réécrit
            automatiquement.
          </p>

          <div class="mt-4 flex flex-col gap-2">
            @if (!resetConfirming()) {
              <button
                type="button"
                class="self-start rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                (click)="resetConfirming.set(true)"
              >
                Réinitialiser le workflow au template par défaut
              </button>
            } @else {
              <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
                <p class="text-red-900">
                  Ceci va <strong>écraser</strong> le fichier workflow actuel sur la branche par défaut
                  de {{ project.githubRepoFullName }}, y compris toute personnalisation que vous y avez
                  apportée.
                </p>
                <div class="mt-3 flex gap-2">
                  <button
                    type="button"
                    class="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                    [disabled]="resetting()"
                    (click)="resetWorkflow()"
                  >
                    {{ resetting() ? 'Réinitialisation…' : 'Confirmer' }}
                  </button>
                  <button
                    type="button"
                    class="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                    (click)="resetConfirming.set(false)"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            }
          </div>

          @if (resetDone()) {
            <p class="mt-3 text-sm text-green-700">Workflow réinitialisé au template par défaut.</p>
          }
          @if (resetError()) {
            <p role="alert" class="mt-3 text-sm text-red-600">{{ resetError() }}</p>
          }
        </section>

        <button
          type="button"
          class="self-start rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
          (click)="remove()"
        >
          Supprimer le projet
        </button>
      } @else {
        <p role="status" class="text-sm text-neutral-500">Chargement du projet…</p>
      }
    </div>
  `,
})
export class ProjectDetail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly projectsService = inject(ProjectsService);

  protected readonly project = signal<Project | null>(null);
  protected readonly readiness = signal<RepoReadiness | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly readinessError = signal<string | null>(null);
  protected readonly setupConfirming = signal(false);
  protected readonly settingUp = signal(false);
  protected readonly webDir = signal('www');
  protected readonly setupResult = signal<SetupTriggerResult | null>(null);
  protected readonly setupError = signal<string | null>(null);
  protected readonly resetConfirming = signal(false);
  protected readonly resetting = signal(false);
  protected readonly resetDone = signal(false);
  protected readonly resetError = signal<string | null>(null);

  protected readonly isFullyReady = computed(() => {
    const readiness = this.readiness();
    return !!readiness?.capacitorInstalled && (readiness.androidPlatformAdded || readiness.iosPlatformAdded);
  });

  protected readonly setupCommand = computed(() => {
    const readiness = this.readiness();
    if (!readiness) {
      return '';
    }
    const steps: string[] = [];
    if (!readiness.capacitorInstalled) {
      steps.push('npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios');
      steps.push('npx cap init');
    }
    if (!readiness.androidPlatformAdded) {
      steps.push('npx cap add android');
    }
    if (!readiness.iosPlatformAdded) {
      steps.push('npx cap add ios');
    }
    return steps.join('\n');
  });

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
      return;
    }
    try {
      this.readiness.set(await this.projectsService.getReadiness(id));
    } catch {
      this.readinessError.set('Impossible d’analyser le dépôt.');
    }
  }

  protected async triggerSetup(): Promise<void> {
    const project = this.project();
    if (!project) {
      return;
    }
    this.settingUp.set(true);
    this.setupError.set(null);
    try {
      this.setupResult.set(await this.projectsService.triggerSetup(project.id, this.webDir()));
      this.setupConfirming.set(false);
    } catch {
      this.setupError.set('Impossible de lancer la configuration automatique.');
    } finally {
      this.settingUp.set(false);
    }
  }

  protected async resetWorkflow(): Promise<void> {
    const project = this.project();
    if (!project) {
      return;
    }
    this.resetting.set(true);
    this.resetError.set(null);
    try {
      await this.projectsService.resetBuildWorkflow(project.id);
      this.resetDone.set(true);
      this.resetConfirming.set(false);
    } catch {
      this.resetError.set('Impossible de réinitialiser le workflow.');
    } finally {
      this.resetting.set(false);
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
