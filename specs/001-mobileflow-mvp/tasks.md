# Tasks — Phase 0 (Fondations)

**Statut** : Prêt à démarrer dès validation de [plan.md](./plan.md)
Référence : plan.md §3 "Phase 0"

- [ ] **T0.1** — Trancher ORM (TypeORM vs Prisma), provider email, provider d'hébergement UE (plan.md §5)
- [x] **T0.2** — Créer `package.json` racine en npm workspaces (`apps/web`, `apps/api`)
- [x] **T0.3** — Déplacer l'app Angular actuelle (`src/`, `angular.json`, `tsconfig*.json`, `public/`) vers `apps/web/`, adapter les chemins et scripts
- [x] **T0.4** — Scaffold `apps/api` (NestJS CLI), modules vides : `auth`, `github`, `projects`, `build-configs`, `secrets`, `builds`, `notifications`
- [ ] **T0.5** — Connexion Postgres + migration initiale couvrant le schéma de spec.md §1 (`User`, `Project`, `BuildConfig`, `Secret`, `Build`)
- [ ] **T0.6** — CI repo MobileFlow : lint + test + build pour `apps/web` et `apps/api` séparément
- [ ] **T0.7** — Redis + BullMQ configurés dans `apps/api` (queue vide, pas encore de jobs)
- [x] **T0.8** — Vérifier que `apps/web` (`ng build`, tests Vitest) et `apps/api` (`nest build`) fonctionnent sans régression après la restructuration

**Dépendance pour la suite** : Phase 1 (Authentification) ne peut démarrer qu'après T0.4 et T0.5.
