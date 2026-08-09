# Tasks — Phase 0 (Fondations)

**Statut** : Prêt à démarrer dès validation de [plan.md](./plan.md)
Référence : plan.md §3 "Phase 0"

- [x] **T0.1** — ~~ORM tranché : Prisma~~ **Revu en Phase 1 (T1.7) : remplacé par Firebase Firestore**, cf. plus bas. Provider email et hébergement UE restent différés (non bloquants avant Phase 6).
- [x] **T0.2** — Créer `package.json` racine en npm workspaces (`apps/web`, `apps/api`)
- [x] **T0.3** — Déplacer l'app Angular actuelle (`src/`, `angular.json`, `tsconfig*.json`, `public/`) vers `apps/web/`, adapter les chemins et scripts
- [x] **T0.4** — Scaffold `apps/api` (NestJS CLI), modules vides : `auth`, `github`, `projects`, `build-configs`, `secrets`, `builds`, `notifications`
- [x] **T0.5** — ~~Connexion Postgres + migration initiale~~ **Sans objet** : le datastore a été remplacé par Firestore (T1.7) avant toute migration Postgres réelle — aucune base Postgres n'a jamais été provisionnée.
- [x] **T0.6** — CI repo MobileFlow : lint + test + build pour `apps/web` et `apps/api` séparément (`.github/workflows/ci.yml`)
- [x] **T0.7** — Redis + BullMQ configurés dans `apps/api` (`QueueModule`, connexion via `REDIS_URL`, pas encore de jobs)
- [x] **T0.8** — Vérifier que `apps/web` (`ng build`, tests Vitest) et `apps/api` (`nest build`) fonctionnent sans régression après la restructuration

**Dépendance pour la suite** : Phase 1 (Authentification) ne peut démarrer qu'après T0.4.

---

# Tasks — Phase 1 (Authentification)

Référence : plan.md §3 "Phase 1", spec.md §2 (contrats) et §4 (FR-1)

- [x] **T1.1** — Backend : dépendances Passport/JWT/bcrypt/OAuth (`@nestjs/jwt`, `@nestjs/passport`, `@nestjs/config`, `passport-local`, `passport-jwt`, `passport-google-oauth20`, `passport-github2`, `bcrypt`, `class-validator`)
- [x] **T1.2** — Backend : `AuthModule` — `register`/`login` email+password (bcrypt), stratégies `local`/`jwt`/`google`/`github`, guards, `GET /auth/me` (hydratation session après redirect OAuth, ajout non prévu initialement dans spec.md §2 mais nécessaire au flow OAuth — spec.md mis à jour)
- [x] **T1.3** — Backend : variables d'env (`JWT_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_OAUTH_CLIENT_ID/SECRET`, `FRONTEND_URL`), `ValidationPipe` globale, CORS, `AuthModule`/`ConfigModule` dans `AppModule`
- [x] **T1.4** — Frontend : `AuthService` (signals), `authGuard` (FR-1 : redirection `/auth/login` si non authentifié), intercepteur HTTP JWT
- [x] **T1.5** — Frontend : écrans `/auth/login`, `/auth/register`, `/auth/callback` (retour OAuth), standalone/OnPush/reactive forms/AXE-friendly ; nettoyage du scaffold Angular par défaut (`app.html`/`app.css` → template inline)
- [x] **T1.6** — Vérification : build+lint+test `apps/api` et `apps/web` verts (racine du monorepo), parcours manuel vérifié en preview (redirection non-authentifié, validation de formulaire, login échoué géré proprement, session simulée → page protégée → logout)

**Non couvert dans cette phase (attendu)** : callback GitHub OAuth pointe vers un OAuth App classique (login), pas la GitHub App d'installation (Phase 2) ; aucune vérification manuelle des flux Google/GitHub réels n'a été faite (nécessite des identifiants OAuth valides, hors de portée locale) — seule la mécanique (redirection, callback, `/auth/me`) a été validée par lecture de code et tests.

---

## Correctifs post-vérification (test manuel utilisateur)

Le test manuel du flow GitHub OAuth par l'utilisateur (credentials réels fournis) a révélé deux problèmes non détectés par les vérifications automatisées ci-dessus :

- [x] **T1.7** — **Changement de datastore : Prisma/Postgres → Firebase Firestore.** Aucun Postgres/Docker/Homebrew disponible en local ; décision utilisateur de basculer sur un projet Firebase existant plutôt que de provisionner Postgres. Impact : suppression complète de Prisma (`prisma/`, `generated/`, `src/prisma/`, deps `@prisma/*`/`pg`), ajout de `firebase-admin` + `FirestoreModule`/`FirestoreService` (`src/firestore/`), modèle `User` local (`src/users/user.model.ts`), réécriture de `AuthService`/`JwtStrategy`/`AuthController` sur des requêtes Firestore (collection `users`). BullMQ/Redis conservés pour la queue (décision explicite). spec.md §1 et plan.md mis à jour en conséquence.
- [x] **T1.8** — **Bug corrigé : callback OAuth ne créait jamais l'utilisateur en base.** `GoogleStrategy`/`GithubStrategy` ne renvoient que `{ email }` (pas d'id/plan), et le contrôleur signait directement le JWT à partir de ce payload incomplet → token sans `sub`, rejeté par `/auth/me` (d'où l'erreur "Connexion impossible." côté frontend). Fix : `googleCallback`/`githubCallback` appellent désormais `authService.findOrCreateOAuthUser(email, provider)` (upsert Firestore) avant d'émettre la session.
- [x] **T1.9** — Parcours GitHub OAuth validé de bout en bout par l'utilisateur, credentials Firebase réels renseignés dans `apps/api/.env` : autorisation GitHub → callback → utilisateur créé dans Firestore (collection `users`, projet `adddemo-bfd9d`) → redirection frontend → session active (page d'accueil affiche l'email connecté).

**Point ouvert (non bloquant)** : le projet Firebase utilisé (`adddemo-bfd9d`) est en région `asia-southeast1`, alors que le PRD impose un hébergement UE (RGPD). À corriger avant mise en production (nouveau projet Firebase en région EU, ou reconfiguration) — sans impact sur le développement local en cours.

---

# Tasks — Phase 2 (Intégration GitHub App)

Référence : plan.md §3 "Phase 2", spec.md §2 (contrats), §4 (FR-2)

- [x] **T2.1** — Backend : dépendance `octokit` (App + Octokit REST unifiés). Le package est **ESM-only** (`"type": "module"`) ; `apps/api` compile en CommonJS, donc chargement via `import()` dynamique (natif en `module: "nodenext"`) dans `GithubService`, jamais via `require()` statique — même classe de bug que celle rencontrée avec Prisma en Phase 1 (cf. T1.7), évitée ici dès la conception.
- [x] **T2.2** — Backend : `GithubModule` (`src/github/`) — `GithubService` (App Octokit paresseuse, `getInstallUrl`, `connectInstallation`, `listRepos`, `listBranches`, `getActionsQuota`), `GithubController` (toutes routes protégées par `JwtAuthGuard`, cohérent avec la règle spec.md §2 "JWT sur toutes les routes sauf `/auth/*`" — pas de mécanisme `state` séparé nécessaire), DTO `ConnectInstallationDto`.
- [x] **T2.3** — Backend : `AuthenticatedUser`/`UserDocument` exposent désormais `githubInstallationId` de bout en bout (`register`, `login`, OAuth, `/auth/me`) pour que le frontend sache si la GitHub App est connectée.
- [x] **T2.4** — Backend : variables d'env `GITHUB_APP_SLUG`/`GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY` (`.env.example` documenté, valeurs de dev factices dans `.env`).
- [x] **T2.5** — Frontend : `GithubService` (`core/github/`), écran `/github/connect` (FR-2 : liste explicite des permissions `contents:write`/`actions:write`/`actions:read` chargée et affichée **avant** la redirection GitHub, bouton de connexion désactivé tant que l'URL n'est pas chargée), écran `/github/connect/callback` (lecture `installation_id`/`setup_action`, gestion du cas `setup_action=request` en attente d'approbation admin org), `AuthService.refreshUser()` pour resynchroniser la session après connexion. Home affiche le statut GitHub connecté / lien de connexion.
- [x] **T2.6** — Vérification : build+lint+test verts (`apps/api`, `apps/web`) ; parcours vérifié en preview avec un utilisateur Firestore réel et un `installation_id` simulé : écran de consentement (3 permissions affichées) → callback → `githubInstallationId` persisté dans Firestore (confirmé via `GET /auth/me`) → redirection `/` → "GitHub connecté." affiché.
- [x] **T2.7** — Frontend : `/github/connect` gère aussi l'état "déjà connecté" — liste des repos accessibles (`GET /github/repos`) et lien "Connecter d'autres dépôts" (réouvre l'écran d'installation GitHub, qui permet d'ajouter/retirer des repos sur une installation existante — pas besoin d'un sélecteur de repo custom, GitHub gère déjà ce choix nativement lors de l'installation). Backend : erreurs API GitHub (repo/installation introuvable) renvoyées en 404 explicite au lieu d'un 500 générique.
- [x] **T2.8** — **Test manuel utilisateur avec une vraie GitHub App** (`mobileflow-pkgr`, App ID `4530598`) : le premier essai échouait silencieusement — après autorisation sur GitHub, l'utilisateur était redirigé vers `https://github.com/settings/installations/:id` (page GitHub par défaut) au lieu du callback MobileFlow. Cause : la **Setup URL** de la GitHub App n'était pas réellement enregistrée (chaque section de la page de settings GitHub a son propre bouton "Save changes" — le champ était rempli visuellement mais pas sauvegardé). Corrigé côté configuration GitHub (pas de changement de code) ; parcours complet revalidé par l'utilisateur : installation → choix du repo (`pwademo`) dans le sélecteur natif GitHub → autorisation → redirection `/github/connect/callback` → session mise à jour.

**Non couvert / limites connues** :
- `GET /github/repos/:repo/actions-quota` est **best-effort** : les endpoints de billing/quota Actions de GitHub ne sont généralement pas accessibles via un token d'installation GitHub App pour un compte personnel (permissions non disponibles côté App). L'implémentation tente l'appel et dégrade proprement (`{ available: false }`) en cas d'échec plutôt que de faire échouer la requête. À revisiter en Phase 5 (FR-7) si un vrai quota est nécessaire — piste : token utilisateur avec scope billing, ou compte org avec "billing manager".
- `POST /internal/github/webhook` (Phase 5) nécessitera une clé de signature webhook GitHub App distincte, non ajoutée ici (YAGNI tant qu'aucun webhook n'est reçu).

---

# Tasks — Phase 3 (Projets & configuration de build)

Référence : plan.md §3 "Phase 3", spec.md §2 (contrats), §4 (FR-3, FR-4)

**Itération 1 (T3.1-T3.6, révisée ci-dessous)** : première implémentation avec un écran `/projects/new` manuel (nom + repo + branche + plateformes portées par `Project`) et un `BuildConfig` persistant séparé (`/projects/:id/build-config`). **Remplacée par le refactor T3.7-T3.12** suite au retour utilisateur : ce flow ne correspondait pas à l'usage réel — la branche et la plateforme sont des propriétés d'un *build*, pas d'un projet, et l'activation d'un repo doit créer un projet automatiquement sans formulaire.

- [x] **T3.1 à T3.6** — Implémentation initiale (voir historique git) puis remplacée intégralement par le refactor ci-dessous.

## Refactor : activation de repo → projet auto-créé, branche/plateforme portées par le Build

- [x] **T3.7** — Backend : `Project` simplifié — retrait de `defaultBranch`/`platforms` (`project.model.ts`). `ProjectsService.create` ne prend plus que `githubRepoFullName` (+ `name` optionnel, dérivé du repo si omis) ; vérifie que le repo appartient bien aux dépôts accessibles de l'utilisateur via `GithubService.listRepos` (remplace l'ancienne validation de branche, devenue sans objet) et rejette les doublons (409 `ConflictException` si un projet existe déjà pour ce repo).
- [x] **T3.8** — Backend : `BuildConfigsModule` supprimé entièrement, remplacé par `BuildsModule` (`src/builds/`) — `Build` (collection `builds`) porte désormais `branch`, `platform` (un Build = une plateforme, conforme à spec.md §1), `environment`, `envVars`, `commitSha` (résolu réellement via `GithubService.getBranchHeadSha`, nouvel appel `octokit.rest.repos.getBranch`), `status` (toujours `queued` — pas d'exécution réelle, cf. limites ci-dessous). `POST /projects/:id/builds` crée un `Build` par plateforme sélectionnée ; `GET /projects/:id/builds` liste l'historique (tri par `createdAt` desc en mémoire, pas d'index composite Firestore nécessaire).
- [x] **T3.9** — Backend : wiring `AppModule`/`ProjectsModule` (`BuildsModule` remplace `BuildConfigsModule`) ; build+lint+test verts.
- [x] **T3.10** — Frontend : `core/projects/` mis à jour (`Project` sans branche/plateformes, `Build`/`CreateBuildPayload`, `ProjectsService.listBuilds`/`createBuild` remplacent les anciennes méthodes `*BuildConfig*`).
- [x] **T3.11** — Frontend : `/github/connect` affiche un bouton **"Activer"** par dépôt accessible (calcule les repos déjà activés via `ProjectsService.list()` croisé avec `GithubService.listRepos()`) — un clic crée le projet automatiquement (aucun formulaire) et l'état passe à **"Actif"** (lien vers le projet). Écran `/projects/new` supprimé. `/projects/:id` : affiche uniquement nom + repo, navigation vers **"Lancer un build"** (`/projects/:id/builds/new`) et **"Historique des builds"** (`/projects/:id/builds`, avant "bientôt disponible", désormais fonctionnel) ; Secret Vault reste "bientôt disponible" (Phase 4).
- [x] **T3.12** — Frontend : écran `/projects/:id/builds/new` (remplace `/projects/:id/build-config`) — formulaire réactif environnement + branche (chargée dynamiquement depuis le repo) + plateformes (validateur `atLeastOnePlatform`) + variables d'env ; soumission → `POST /projects/:id/builds` → redirection vers l'historique. Écran `/projects/:id/builds` liste les builds (environnement, plateforme, branche, statut, commit court).
- [x] **T3.13** — Vérification : build+lint+test verts (`apps/api`, `apps/web`) ; parcours complet revalidé en preview avec l'installation GitHub App réelle (`FazioNico/pwademo`) : activation du repo depuis `/github/connect` (bouton "Activer" → "Actif") → détail projet (`pwademo`, nom dérivé automatiquement du repo) → "Lancer un build" (branche + 2 plateformes cochées) → soumission crée bien **2** `Build` distincts (un par plateforme, commit SHA réel résolu) → apparition dans l'historique trié par date décroissante. Aucune erreur console.

**Non couvert / limites connues** :
- `envVars` des `Build` sont stockées **en clair** dans Firestore à ce stade (le chiffrement KMS par tenant décrit en spec.md §5 est explicitement scope de la Phase 4 — Secret Vault). Ne pas y stocker de secrets sensibles avant la Phase 4.
- Un `Build` créé reste **indéfiniment au statut `queued`** : aucun déclenchement réel de `workflow_dispatch` GitHub Actions, aucune synchronisation via webhook `workflow_run`. C'est un scaffold volontaire (historique + formulaire fonctionnels) en attendant la Phase 5 (Build Engine, FR-5/FR-6/FR-9) qui branchera l'exécution réelle et les transitions de statut.
- Pas de mécanisme de déclenchement automatique sur push (`BuildConfig.autoTriggerBranch` existait dans l'itération précédente puis a été retiré avec la suppression de `BuildConfig`) — FR-6 nécessitera de décider où persister ce paramètre (probablement sur `Project` ou un nouvel objet dédié) lors de la Phase 5/6, en lien avec le webhook GitHub.
- Pas de vérification que `githubRepoFullName` reste accessible dans le temps (ex. désinstallation de la GitHub App après activation) — un projet peut référencer un repo devenu inaccessible ; le prochain `POST /projects/:id/builds` échouera alors proprement (404 via `GithubService`) plutôt que silencieusement.

---

# Tasks — Phase 4 (Secret Vault)

Référence : plan.md §3 "Phase 4", spec.md §2 (contrats), §4 (FR-8), §5 (sécurité)

- [x] **T4.1** — Backend : `CryptoModule`/`EncryptionService` (`src/crypto/`) — chiffrement AES-256-GCM, clé maître `MASTER_ENCRYPTION_KEY` (variable d'env, format hex 32 bytes) dérivée en clé par tenant via HKDF-SHA256 (`masterKey + userId`). Décision utilisateur explicite : pas de KMS cloud (GCP Cloud KMS) à ce stade, cohérent avec l'absence d'infra cloud provisionnée ailleurs dans le projet — migrable plus tard sans changer le contrat de `SecretsService`.
- [x] **T4.2** — Backend : `SecretsModule` (`src/secrets/`) — `Secret` (collection `secrets`) porte `type` (`ios_certificate` | `android_keystore`), `fileName`, et un payload chiffré unique (`ciphertext`/`iv`/`authTag`) contenant `{ fileBase64, password, alias, keyPassword }` sérialisé en JSON avant chiffrement. Un seul secret actif par type et par projet (un nouvel upload remplace le précédent). `SecretsController` inexistant : routes nested sous `ProjectsController` (`POST/GET /projects/:id/secrets`, `DELETE /projects/:id/secrets/:secretId`), suivant le pattern déjà établi pour `BuildsService` en Phase 3. **Le payload déchiffré n'est jamais renvoyé par l'API** — `findAllForProject`/`create` ne retournent que `{ id, type, fileName, createdAt }` (vérifié par appel direct à l'API en preview).
- [x] **T4.3** — Backend : wiring `ProjectsModule`/`AppModule`, `MASTER_ENCRYPTION_KEY` documentée dans `.env.example` (avec commande de génération locale) et renseignée dans `.env` ; build+lint+test verts.
- [x] **T4.4** — Frontend : `core/projects/project.models.ts`/`projects.service.ts` étendus avec `Secret`/`CreateSecretPayload`/`listSecrets`/`createSecret`/`removeSecret` (même module que `Project`/`Build`, pas de `core/secrets/` séparé — cohérent avec le pattern Phase 3 où les sous-ressources d'un projet vivent dans `core/projects/`).
- [x] **T4.5** — Frontend : écran `/projects/:id/secrets` (`features/projects/secrets/project-secrets.ts`) — formulaire réactif accessible (labels explicites, `aria-invalid`, changement dynamique du libellé mot de passe et des champs alias/clé selon le type sélectionné), lecture du fichier en base64 côté client via `FileReader` (jamais uploadé tel quel, jamais réaffiché), liste des secrets enregistrés avec suppression. Lien "Secret Vault" activé dans `/projects/:id` (remplace le span désactivé "bientôt disponible") ; route ajoutée dans `app.routes.ts`.
- [x] **T4.6** — Vérification : build+lint+test verts (`apps/api`, `apps/web`) ; parcours vérifié en preview avec le projet `pwademo` réel — upload d'un keystore Android (fichier + mot de passe + alias + mot de passe de clé optionnel) puis d'un certificat iOS (fichier + mot de passe), suppression d'un secret, et confirmation par appel direct à l'API que la réponse ne contient jamais `ciphertext`/`iv`/`authTag`. Un bug a été détecté et corrigé pendant cette vérification (cf. Errors ci-dessous).

**Bug corrigé pendant le développement** : `toSignal(this.form.controls.type.valueChanges, …)` utilisé comme initialiseur de champ dans `ProjectSecrets` levait `NG0203` (hors contexte d'injection) au runtime malgré une compilation sans erreur. Remplacé par une méthode simple `selectedType()` lisant directement `this.form.controls.type.value` — suffisant ici car les événements DOM (`change` sur le `<select>`) passent par Zone.js et déclenchent la détection de changement même sous `OnPush`, sans besoin d'un signal dérivé explicite.

**Non couvert / limites connues** :
- `MASTER_ENCRYPTION_KEY` est une clé unique en variable d'env, sans rotation ni gestion via un secret manager dédié — acceptable pour le développement local, à revoir avant la mise en production (rotation de clé, stockage dans un vault type GCP Secret Manager plutôt qu'un `.env`).
- Le payload déchiffré n'est exposé à aucun endpoint pour l'instant : l'endpoint interne `/internal/runs/:runId/secrets` (FR-8, token de run à courte durée de vie scopé à un `Build.id`) est explicitement scope de la Phase 5 (Build Engine), qui consommera `EncryptionService.decrypt()` pour injecter les secrets dans le workflow GitHub Actions au moment du build.
- Pas de validation de format du fichier uploadé (ex. vérifier qu'un `.p12` est un keystore PKCS#12 valide, qu'un certificat n'est pas déjà expiré) — FR-9 (échec explicite si certificat expiré au moment du build) est aussi scope Phase 5, au moment de l'utilisation réelle du secret.
- Pas de limite de taille explicite sur l'upload (`fileBase64` en `IsString` simple) — un certificat/keystore fait quelques Ko à quelques centaines de Ko en pratique, donc non bloquant pour le MVP, mais à durcir avant prod (`class-validator` `@MaxLength` ou limite au niveau du `ValidationPipe`/reverse proxy).
