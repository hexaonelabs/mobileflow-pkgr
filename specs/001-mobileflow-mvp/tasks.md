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
- Aucun test manuel avec une **vraie** GitHub App (App ID/clé privée/slug réels) n'a été fait — `apps/api/.env` contient des valeurs factices (`GITHUB_APP_ID="0"`, clé bidon). Le flow a été validé avec un `installation_id` simulé côté backend (Firestore réel, JWT réel) ; à revalider en conditions réelles dès que l'utilisateur crée la GitHub App sur github.com (Setup URL à configurer : `${FRONTEND_URL}/github/connect/callback`, permissions Contents/Actions/Metadata).
- `POST /internal/github/webhook` (Phase 5) nécessitera une clé de signature webhook GitHub App distincte, non ajoutée ici (YAGNI tant qu'aucun webhook n'est reçu).
