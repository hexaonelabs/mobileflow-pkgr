# Plan technique — MobileFlow MVP

**Statut** : Dérivé de [spec.md](./spec.md) — **restructuration du repo à confirmer avant exécution** (déplacement de l'app Angular existante)

---

## 1. Structure du repo

Le repo actuel est une app Angular CLI simple à la racine (`src/`, `angular.json`). Passage à un monorepo **npm workspaces** (pas d'Nx — inutile pour 2 apps, évite un outillage supplémentaire non requis) :

```
MobileFlow/
├── package.json              # racine, "workspaces": ["apps/web", "apps/api"]
├── apps/
│   ├── web/                  # app Angular actuelle, déplacée telle quelle
│   │   ├── src/
│   │   ├── angular.json
│   │   └── package.json
│   └── api/                  # nouveau, NestJS
│       ├── src/
│       │   ├── auth/
│       │   ├── github/       # GitHub App: install, repos, webhook
│       │   ├── projects/
│       │   ├── build-configs/
│       │   ├── secrets/      # Secret Vault + chiffrement
│       │   ├── builds/       # déclenchement, historique, artefacts
│       │   └── notifications/
│       └── package.json
├── specs/001-mobileflow-mvp/ # prd.md, spec.md, plan.md, tasks.md (ce dossier)
└── .github/workflows/        # CI du repo MobileFlow lui-même (lint/test/build) — distinct des workflows GÉNÉRÉS pour les repos utilisateurs
```

Le fichier workflow généré et poussé dans les repos **utilisateurs** (cf. spec.md §2) est un template maintenu dans `apps/api/src/builds/workflow-templates/`, pas dans `.github/` de MobileFlow.

## 2. Stack détaillée

| Composant | Choix | Justification |
|---|---|---|
| Datastore | Firebase Firestore (SDK `firebase-admin`) — décidé en Phase 1 (remplace Prisma/Postgres, cf. tasks.md T0.1/T1.7) | Pas d'infra Postgres à provisionner en local/dev ; le projet Firebase de l'utilisateur sert de source de vérité pour credentials |
| Auth | Passport.js (stratégies `local`, `google-oauth20`) + JWT | Standard NestJS |
| GitHub App | Octokit (`@octokit/app`, `@octokit/webhooks`) | Gestion installation, webhooks, API Artifacts |
| Chiffrement secrets | KMS applicatif (ex. clé maître + libsodium/AES-256-GCM par tenant) | Cf. spec.md §5 |
| Queue | BullMQ + Redis | Déjà acté PRD — orchestration `workflow_dispatch`, pas de compute |
| Email | Provider transactionnel (ex. Resend/Postmark) — **à trancher en Phase 0** | Notifications build démarré/terminé/échoué |
| Hébergement | Région UE (cf. PRD §3.2) — provider précis **à trancher en Phase 0** | RGPD |

## 3. Phasage de livraison

**Phase 0 — Fondations (infra + squelette)**
- Restructuration monorepo (§1)
- Scaffold NestJS (`apps/api`) : modules vides
- CI du repo MobileFlow (lint, test, build des deux apps)
- Décisions email/hébergement tranchées (le datastore a été revu en Phase 1, cf. tasks.md T1.7)

**Phase 1 — Authentification**
- FR-1 : email/password + Google OAuth + GitHub OAuth (login utilisateur — distinct de l'installation GitHub App)
- Écrans `/auth/login`, `/auth/register`

**Phase 2 — Intégration GitHub App**
- FR-2 : flow d'installation GitHub App, écran de consentement explicite
- Endpoints `/github/*` (repos, branches, quota Actions)
- Écran `/github/connect`

**Phase 3 — Projets & configuration de build**
- FR-3, FR-4 : CRUD `Project`, `BuildConfig`
- Écrans `/projects`, `/projects/new`, `/projects/:id/build-config`

**Phase 4 — Secret Vault**
- FR-8 : upload chiffré, jamais de payload en clair côté client
- Écran `/projects/:id/secrets`

**Phase 5 — Build Engine**
- FR-5, FR-6, FR-7, FR-9 : génération/push du workflow dans le repo utilisateur, déclenchement manuel + push, token de run à courte durée de vie, endpoint interne de récupération des secrets, quota Actions affiché avant lancement
- Webhook `workflow_run` → synchronisation `Build` en base

**Phase 6 — Historique, artefacts, notifications**
- FR-10, FR-11, FR-12 : écrans historique + détail build, proxy artefact, emails transactionnels

**Phase 7 — Durcissement**
- AXE/WCAG AA sur tous les écrans (cf. CLAUDE.md)
- Tests e2e du parcours DoD complet (PRD §8)
- Vérification NFR : temps de compilation, quota, RGPD (résidence UE confirmée)

## 4. Stratégie de test

- **Backend** : tests unitaires par module NestJS (Jest par défaut NestJS), tests d'intégration sur les endpoints critiques (`/internal/runs/:runId/secrets`, webhook signature).
- **Frontend** : Vitest (déjà en place) pour les composants/services, AXE automatisé en CI sur les écrans listés en spec.md §3.
- **Bout en bout** : un scénario couvrant le DoD PRD §8 (inscription → connexion GitHub → projet → build → artefact → historique), exécuté avec un repo GitHub de test dédié (fixture).

## 5. Décisions restantes (non bloquantes pour démarrer, à trancher en Phase 0)

- Provider email transactionnel
- Provider d'hébergement précis (région UE actée, pas le provider) — la résidence des données Firestore dépend de la région choisie sur le projet Firebase existant, à vérifier avant la mise en prod (cf. PRD §3.2 RGPD)

Ces décisions sont volontairement légères et n'affectent pas le schéma de données ni les contrats API définis en spec.md — elles peuvent être tranchées au démarrage de la Phase 0 sans revalider le PRD.
