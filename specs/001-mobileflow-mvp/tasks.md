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
