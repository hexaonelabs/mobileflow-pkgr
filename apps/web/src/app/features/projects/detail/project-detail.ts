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
    <main class="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-8">
      @if (errorMessage()) {
        <p role="alert" class="text-sm text-red-600">{{ errorMessage() }}</p>
      } @else if (project(); as project) {
        <div>
          <h1 class="text-2xl font-semibold">{{ project.name }}</h1>
          <p class="text-sm text-gray-600">{{ project.githubRepoFullName }}</p>
        </div>

        <section aria-labelledby="readiness-heading" class="rounded border border-gray-300 p-4">
          <h2 id="readiness-heading" class="text-lg font-medium">Préparation du dépôt</h2>
          @if (readiness(); as readiness) {
            <ul class="mt-2 flex flex-col gap-1 text-sm">
              <li [class]="readiness.capacitorInstalled ? 'text-green-700' : 'text-amber-700'">
                {{ readiness.capacitorInstalled ? '✓' : '✗' }} Capacitor installé (@capacitor/core dans package.json)
              </li>
              <li [class]="readiness.androidPlatformAdded ? 'text-green-700' : 'text-amber-700'">
                {{ readiness.androidPlatformAdded ? '✓' : '✗' }} Plateforme Android ajoutée (dossier android/)
              </li>
              <li [class]="readiness.iosPlatformAdded ? 'text-green-700' : 'text-amber-700'">
                {{ readiness.iosPlatformAdded ? '✓' : '✗' }} Plateforme iOS ajoutée (dossier ios/)
              </li>
            </ul>
            @if (!isFullyReady()) {
              <p class="mt-3 text-sm text-gray-600">
                Pour que les builds compilent réellement, exécutez localement dans votre dépôt :
              </p>
              <pre class="mt-1 overflow-x-auto rounded bg-gray-100 p-2 text-xs">{{ setupCommand() }}</pre>
              <p class="mt-1 text-sm text-gray-600">puis committez et poussez les fichiers générés.</p>

              <div class="mt-3 flex flex-col gap-2">
                @if (!setupConfirming()) {
                  <button
                    type="button"
                    class="self-start rounded border border-gray-400 px-3 py-1 text-sm"
                    (click)="setupConfirming.set(true)"
                  >
                    Configurer automatiquement
                  </button>
                } @else {
                  <div class="rounded border border-amber-400 bg-amber-50 p-3 text-sm">
                    <p>
                      Ceci va pousser un commit dans votre dépôt GitHub ({{ project.githubRepoFullName }})
                      pour installer Capacitor et/ou ajouter les plateformes manquantes.
                    </p>
                    <div class="mt-2 flex flex-col gap-1">
                      <label class="text-sm font-medium" for="web-dir">
                        Répertoire de build web (webDir)
                      </label>
                      <input
                        id="web-dir"
                        type="text"
                        class="rounded border border-gray-400 px-2 py-1"
                        [value]="webDir()"
                        (input)="webDir.set($any($event.target).value)"
                      />
                      <p class="text-xs text-gray-600">
                        Répertoire où votre commande de build (ex. <code>npm run build</code>) génère les
                        fichiers statiques. Par défaut "www", mais dépend de votre framework (ex. Angular :
                        dist/&lt;nom-projet&gt;/browser).
                      </p>
                    </div>
                    <div class="mt-2 flex gap-2">
                      <button
                        type="button"
                        class="rounded bg-gray-900 px-3 py-1 text-white disabled:opacity-50"
                        [disabled]="settingUp()"
                        (click)="triggerSetup()"
                      >
                        {{ settingUp() ? 'Lancement…' : 'Confirmer' }}
                      </button>
                      <button
                        type="button"
                        class="rounded border border-gray-400 px-3 py-1"
                        (click)="setupConfirming.set(false)"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                }
              </div>

              @if (setupResult(); as result) {
                <p class="mt-2 text-sm text-green-700">
                  Configuration lancée.
                  @if (result.htmlUrl) {
                    <a class="underline" [href]="result.htmlUrl" target="_blank" rel="noopener noreferrer">
                      Voir le run sur GitHub
                    </a>
                  }
                  — rafraîchissez cette page dans une minute pour voir le statut mis à jour.
                </p>
              }
              @if (setupError()) {
                <p role="alert" class="mt-2 text-sm text-red-600">{{ setupError() }}</p>
              }
            }
          } @else if (!readinessError()) {
            <p role="status" class="text-sm text-gray-600">Analyse du dépôt…</p>
          }
          @if (readinessError()) {
            <p role="alert" class="text-sm text-red-600">{{ readinessError() }}</p>
          }
        </section>

        <section aria-labelledby="workflow-heading" class="rounded border border-gray-300 p-4">
          <h2 id="workflow-heading" class="text-lg font-medium">Workflow de build</h2>
          <p class="mt-1 text-sm text-gray-600">
            MobileFlow n'installe le workflow ({{ '.github/workflows/mobileflow.yml' }}) qu'une seule
            fois : vous pouvez ensuite le personnaliser librement, il ne sera plus jamais réécrit
            automatiquement.
          </p>

          <div class="mt-3 flex flex-col gap-2">
            @if (!resetConfirming()) {
              <button
                type="button"
                class="self-start rounded border border-gray-400 px-3 py-1 text-sm"
                (click)="resetConfirming.set(true)"
              >
                Réinitialiser le workflow au template par défaut
              </button>
            } @else {
              <div class="rounded border border-red-400 bg-red-50 p-3 text-sm">
                <p>
                  Ceci va <strong>écraser</strong> le fichier workflow actuel sur la branche par défaut
                  de {{ project.githubRepoFullName }}, y compris toute personnalisation que vous y avez
                  apportée.
                </p>
                <div class="mt-2 flex gap-2">
                  <button
                    type="button"
                    class="rounded bg-red-600 px-3 py-1 text-white disabled:opacity-50"
                    [disabled]="resetting()"
                    (click)="resetWorkflow()"
                  >
                    {{ resetting() ? 'Réinitialisation…' : 'Confirmer' }}
                  </button>
                  <button
                    type="button"
                    class="rounded border border-gray-400 px-3 py-1"
                    (click)="resetConfirming.set(false)"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            }
          </div>

          @if (resetDone()) {
            <p class="mt-2 text-sm text-green-700">Workflow réinitialisé au template par défaut.</p>
          }
          @if (resetError()) {
            <p role="alert" class="mt-2 text-sm text-red-600">{{ resetError() }}</p>
          }
        </section>

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
