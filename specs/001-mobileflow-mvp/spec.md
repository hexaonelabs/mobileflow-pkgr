# Spec technique — MobileFlow MVP

**Statut** : Dérivé de [prd.md](./prd.md) v1.2 — toutes décisions actées
**Périmètre** : Full-stack, monorepo unique (frontend Angular + backend NestJS)

---

## 1. Modèle de données

### User
| Champ | Type | Notes |
|---|---|---|
| id | uuid | |
| email | string, unique | |
| authProvider | enum(`email`, `google`, `github`) | |
| passwordHash | string, nullable | null si OAuth |
| githubInstallationId | string, nullable | id de l'installation GitHub App |
| plan | enum(`free`, `starter`, `pro`, `enterprise`) | |
| createdAt / updatedAt | timestamp | |

### Project
| Champ | Type | Notes |
|---|---|---|
| id | uuid | |
| userId | uuid (FK) | propriétaire, pas de multi-user en MVP |
| name | string | |
| githubRepoFullName | string | ex. `org/repo` |
| framework | enum(`capacitor`) | figé en MVP — voir non-goals PRD |
| defaultBranch | string | |
| platforms | set(`android`, `ios`) | |
| createdAt / updatedAt | timestamp | |

### BuildConfig
| Champ | Type | Notes |
|---|---|---|
| id | uuid | |
| projectId | uuid (FK) | |
| environment | enum(`staging`, `production`) | |
| envVars | jsonb (clé/valeur, chiffré au repos) | |
| platforms | set(`android`, `ios`) | |
| autoTriggerBranch | string, nullable | branche déclenchant un build auto sur push |

### Secret
| Champ | Type | Notes |
|---|---|---|
| id | uuid | |
| projectId | uuid (FK) | |
| type | enum(`apple_certificate`, `apple_provisioning_profile`, `apple_asc_api_key`, `android_keystore`) | |
| encryptedPayload | bytea | chiffré (voir §5 Sécurité) |
| metadata | jsonb | ex. alias/password ref pour Android, expiresAt pour certs Apple |
| uploadedAt | timestamp | |

### Build
| Champ | Type | Notes |
|---|---|---|
| id | uuid | |
| projectId | uuid (FK) | |
| buildConfigId | uuid (FK) | |
| triggeredBy | enum(`manual`, `push`) | |
| commitSha | string | |
| branch | string | |
| platform | enum(`android`, `ios`) | un build = une plateforme (un run "Android + iOS" = 2 Build) |
| status | enum(`queued`, `running`, `success`, `failed`, `cancelled`) | |
| githubRunId | string, nullable | id du run GitHub Actions correspondant |
| startedAt / finishedAt | timestamp, nullable | |
| durationSeconds | int, nullable | |
| artifactUrl | string, nullable | lien de téléchargement (proxy MobileFlow, pas lien GitHub direct) |
| logsUrl | string, nullable | |
| userId | uuid (FK) | qui a déclenché (manuel) ou null si push |

**Note** : pas d'entité `Team`/`Membership` en MVP (cf. PRD non-goals) — `Project.userId` est la seule relation de possession.

---

## 2. Contrats API (NestJS, REST)

Authentification : JWT (issu de l'auth email/Google/GitHub) sur toutes les routes sauf `/auth/*`.

```
POST   /auth/register                 email + password
POST   /auth/login
GET    /auth/oauth/google/callback
GET    /auth/oauth/github/callback    (login utilisateur, distinct de l'installation GitHub App)

GET    /github/install-url            génère l'URL d'installation de la GitHub App
POST   /github/callback               réception de l'installation_id après consentement
GET    /github/repos                  repos accessibles via l'installation
GET    /github/repos/:repo/branches
GET    /github/repos/:repo/actions-quota   quota Actions restant du compte utilisateur (cf. PRD §4 risques)

POST   /projects
GET    /projects
GET    /projects/:id
PATCH  /projects/:id
DELETE /projects/:id

POST   /projects/:id/build-configs
GET    /projects/:id/build-configs
PATCH  /build-configs/:id

POST   /projects/:id/secrets          upload chiffré (multipart)
GET    /projects/:id/secrets          métadonnées uniquement, jamais le payload déchiffré
DELETE /secrets/:id

POST   /projects/:id/builds           déclenchement manuel
GET    /projects/:id/builds           historique paginé
GET    /builds/:id
GET    /builds/:id/logs
GET    /builds/:id/artifact           proxy de téléchargement (vérifie l'ownership avant d'appeler l'API GitHub Artifacts)

POST   /internal/github/webhook       réception des événements workflow_run (signature vérifiée)
POST   /internal/runs/:runId/secrets  appelée PAR le workflow GitHub Actions (token de run à courte durée de vie) pour récupérer les secrets au runtime — cf. PRD §3.1
```

---

## 3. Écrans / Routes Frontend (Angular)

| Route | Écran | Notes |
|---|---|---|
| `/auth/login`, `/auth/register` | Authentification | Email + boutons Google/GitHub |
| `/github/connect` | Connexion GitHub App | Redirection vers install-url, écran de consentement explicite (permissions GitHub App détaillées — cf. PRD §3.1) |
| `/projects` | Liste des projets | |
| `/projects/new` | Création projet | Sélection repo + branche + framework (verrouillé sur Capacitor) |
| `/projects/:id` | Détail projet | Onglets : Config build / Secrets / Historique |
| `/projects/:id/build-config` | Configuration build | Plateformes, env, variables d'env, branche auto-trigger |
| `/projects/:id/secrets` | Secret Vault | Upload certs Apple / keystore Android, jamais d'affichage du payload déchiffré |
| `/projects/:id/builds` | Historique des builds | Statut, durée, commit, branche, lien artefact |
| `/projects/:id/builds/:buildId` | Détail build | Logs post-mortem (pas de live streaming — cf. PRD non-goals), bouton téléchargement artefact |

Conventions à respecter (CLAUDE.md) : composants standalone, signals, `input()`/`output()`, `OnPush`, reactive forms pour Build Config et Secret upload, `@if`/`@for` natifs, AXE/WCAG AA sur tous les écrans (attention particulière : upload de secrets et écran de consentement GitHub doivent être accessibles au clavier avec focus management correct).

---

## 4. Exigences fonctionnelles (testables)

- **FR-1** : Un utilisateur non authentifié est redirigé vers `/auth/login` sur toute route protégée.
- **FR-2** : La connexion GitHub App doit afficher explicitement les permissions demandées (`contents:write`, `actions:write`, `actions:read`) avant redirection OAuth.
- **FR-3** : La création d'un projet est bloquée tant que repo + branche ne sont pas sélectionnés.
- **FR-4** : Un `BuildConfig` doit avoir au moins une plateforme sélectionnée avant qu'un build puisse être lancé.
- **FR-5** : Un build manuel appelle `workflow_dispatch` sur le workflow généré dans le repo utilisateur.
- **FR-6** : Un push sur `BuildConfig.autoTriggerBranch` déclenche un build automatiquement (le workflow poussé contient un trigger `on: push` scopé) ; les runs redondants sur pushs rapprochés sont annulés via `concurrency`.
- **FR-7** : Avant le lancement d'un build susceptible de dépasser le quota Actions restant de l'utilisateur, l'UI affiche un avertissement (cf. PRD DoD ajout #11).
- **FR-8** : Le payload déchiffré d'un secret n'est jamais renvoyé par l'API sauf à l'endpoint interne `/internal/runs/:runId/secrets`, appelé exclusivement par un token de run à courte durée de vie scopé à un build précis.
- **FR-9** : Si un certificat Apple est expiré au moment du build, le build échoue avec un message d'erreur explicite (pas d'alerte proactive en amont — cf. PRD non-goals).
- **FR-10** : L'historique des builds est filtrable par statut, plateforme, branche.
- **FR-11** : Le téléchargement d'un artefact vérifie l'ownership du projet avant de proxifier l'appel à l'API GitHub Actions Artifacts.
- **FR-12** : Une notification email est envoyée sur les transitions de statut `queued→running`, `running→success`, `running→failed`.

## 5. Sécurité (implémentation)

- Secrets chiffrés au repos avec une clé par tenant dérivée d'une clé maître (KMS), jamais stockés en clair même en base.
- Le token de run (§FR-8) est un JWT signé, TTL court (durée du build + marge), scopé à un seul `Build.id`, généré au moment du `workflow_dispatch`/push et injecté comme input du workflow.
- Vérification de signature sur le webhook GitHub entrant (`/internal/github/webhook`).
- Toutes les routes `/internal/*` sont inaccessibles depuis le frontend (réseau interne ou vérification de token dédiée, pas le JWT utilisateur).

## 6. Hors scope (rappel PRD)

Déploiement stores, Flutter/Expo/RN pur, génération auto de certificats, gestion d'équipe, Slack/Discord, logs live, infra dédiée physique, alerte expiration certificats — voir [prd.md §2.3](./prd.md).
