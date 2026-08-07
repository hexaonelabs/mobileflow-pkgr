# PRD — MobileFlow (MVP)

**Version** : 1.2 (consolidé, toutes décisions tranchées)
**Statut** : Prêt pour `spec.md` / `plan.md`
**Auteur original** : HexaOne Labs — révisé après analyse de faisabilité

> Ce document consolide le draft v1.0 après revue de faisabilité et arbitrage. Toutes les décisions sont marquées **[DÉCIDÉ]**. Il ne reste aucun point bloquant pour la phase de spécification technique.

---

## 1. Executive Summary

**Problem Statement** : Publier une application mobile nécessite un environnement de build complexe (Xcode, Android Studio, CocoaPods, certificats, keystores, souvent un Mac) qui constitue une barrière technique disproportionnée par rapport à la difficulté réelle de développer l'app.

**Proposed Solution** : Une plateforme cloud qui connecte un repo GitHub, compile l'app Capacitor (Android/iOS) via GitHub Actions, signe les binaires et restitue les artefacts — sans installation locale.

**Success Criteria** **[DÉCIDÉ]** :
- Temps moyen inscription → premier build réussi : < 15 min
- Taux de réussite des builds (hors erreurs de code utilisateur) : > 90 %
- Temps de compilation Android / iOS : voir §6 (dépend du runner GitHub, pas garanti par MobileFlow)
- Taux de conversion Free → payant
- MRR, churn

---

## 2. User Experience & Fonctionnalités

### 2.1 Personas
- **Freelance** — plusieurs apps clients, ne veut pas maintenir un Mac.
- **Petite agence** — plusieurs apps/mois, veut automatiser le build. Utilise un compte partagé en MVP ; la gestion d'équipe (invitations, rôles) est repoussée à Enterprise/V2 **[DÉCIDÉ]**.
- **Développeur Web** (Angular/React/Ionic) — pas de compétences mobile natif.

### 2.2 User Stories & Acceptance Criteria

**US1** — En tant que développeur, je veux connecter mon repo GitHub pour ne pas avoir à uploader mon code manuellement.
- AC : OAuth/GitHub App avec accès scoping repo, sélection repo + branche, révocation possible depuis MobileFlow.

**US2** — En tant que développeur, je veux configurer un build (plateforme, env, secrets) une fois et le relancer sans reconfigurer.
- AC : configuration persistée par projet, variables d'env par environnement (staging/production).

**US3** — En tant que développeur, je veux que chaque push sur la branche configurée déclenche un build automatiquement. **[DÉCIDÉ]**
- AC : trigger `on: push` scopé à la branche sélectionnée, annulation des runs redondants (concurrency group) si plusieurs push rapprochés, déclenchement manuel toujours disponible en parallèle.

**US4** — En tant que développeur, je veux récupérer un binaire signé sans gérer moi-même mes certificats à chaque build.
- AC : upload unique des certificats/keystore dans le Secret Vault, réutilisés à chaque run, jamais exposés côté client.

**US5** — En tant que développeur, je veux consulter l'historique et les logs de mes builds.
- AC : liste avec statut/durée/commit/branche/utilisateur, logs consultables après complétion via polling du statut. Pas de streaming live pendant l'exécution en MVP **[DÉCIDÉ]** — ajoutable en V2 sans refonte d'architecture (WebSocket/SSE).

### 2.3 Non-Goals (MVP) — rendus explicites

- ❌ Déploiement automatique App Store / Google Play (V2)
- ❌ Frameworks hors **Capacitor/Ionic** — pas de Flutter, Expo, React Native pur en MVP **[DÉCIDÉ]**
- ❌ Génération/rotation automatique des certificats Apple et keystore Android — upload manuel uniquement en MVP **[DÉCIDÉ]**
- ❌ Gestion d'équipe / permissions multi-utilisateurs — repoussé à Enterprise / V2 **[DÉCIDÉ]**
- ❌ Alerte proactive d'expiration des certificats Apple — repoussé V2 **[DÉCIDÉ]** ; en MVP le build échoue avec un message d'erreur clair si le certificat est expiré
- ❌ Streaming des logs en temps réel — repoussé V2 **[DÉCIDÉ]**
- ❌ Infrastructure physiquement dédiée par client (y compris Enterprise) — isolation logique uniquement en MVP **[DÉCIDÉ]**, voir §3.4
- ❌ Notifications Slack/Discord (V2)
- ❌ Build cache, API publique, CLI (V2)
- ❌ Bitbucket/GitLab/Azure DevOps/self-hosted Git (V2)

---

## 3. Spécifications techniques

### 3.1 Architecture — Build Engine **[DÉCIDÉ]**

Les builds s'exécutent via **GitHub Actions dans le repo de l'utilisateur** (pas dans une infra MobileFlow dédiée), sur des runners **GitHub-hosted standards** (Linux pour Android, macOS pour iOS) — pas de self-hosted runners, pour préserver l'isolation multi-tenant nativement garantie par GitHub (runner éphémère détruit après chaque job).

Flux :
1. MobileFlow (GitHub App, permissions `contents:write` + `actions:write` + `actions:read`) pousse/maintient un fichier workflow généré dans le repo utilisateur.
2. Le workflow est déclenché par push (branche configurée) ou manuellement (`workflow_dispatch` depuis l'UI MobileFlow).
3. Pendant l'exécution, le workflow appelle une API MobileFlow authentifiée (token de run à courte durée de vie) pour récupérer les secrets nécessaires (certificats, keystore, variables d'env) **[DÉCIDÉ — recommandation]** — les secrets ne sont jamais dupliqués dans le GitHub Secrets natif du repo, le Vault MobileFlow reste source unique de vérité.
4. À la fin du run, MobileFlow reçoit un événement `workflow_run` (webhook GitHub) pour synchroniser le statut/durée dans sa propre base (Build History), puis récupère les artefacts via l'API GitHub Actions Artifacts (token scope `actions:read`).

**Conséquences directes à intégrer au produit** :
- Consommation des minutes Actions **du compte GitHub de l'utilisateur** (multiplicateur ×10 sur macOS). MobileFlow doit afficher le quota restant de l'utilisateur et prévenir avant un build susceptible d'échouer par manque de minutes.
- Le consentement GitHub App (write sur le repo) doit être expliqué clairement dans l'onboarding — c'est une permission plus large qu'un simple accès en lecture.
- Le SLA de temps de build (§6) ne couvre que le temps de compilation, pas le temps d'attente en file GitHub (hors contrôle MobileFlow).

### 3.2 Autres composants (inchangés du draft, à date)

- **Frontend** : Angular (standalone, signals, OnPush — cf. conventions projet)
- **Backend** : Node.js / NestJS
- **DB** : PostgreSQL
- **Storage** : Firebase Storage (logs, ressources, artefacts temporaires)
- **Queue** : BullMQ + Redis (orchestration des workflow_dispatch, pas du compute)
- **Hébergement backend** (NestJS + Postgres) : région **UE uniquement** **[DÉCIDÉ]** (ex. GCP/AWS eu-west, ou Scaleway/OVH) — résidence des données en UE pour simplifier la conformité RGPD dès le départ.

### 3.3 Secret Vault

- Apple : certificats, provisioning profiles, App Store Connect API Keys — **upload manuel utilisateur** en MVP **[DÉCIDÉ]**.
- Android : keystore, alias, password — upload manuel utilisateur.
- Chiffrement au repos, transmis via TLS, jamais exposés côté client.
- Perte du keystore Android par l'utilisateur : risque documenté comme responsabilité utilisateur (irrécupérable pour les mises à jour), avertissement fort affiché à l'upload **[DÉCIDÉ]** — pas de fonctionnalité de recovery en MVP.
- Expiration des certificats Apple (valables 1 an) : pas d'alerte proactive en MVP **[DÉCIDÉ]** — le build échoue simplement avec une erreur explicite si le certificat est expiré ; alerte proactive ajoutée en V2.

### 3.4 Sécurité & Conformité

- Secrets chiffrés au repos, TLS en transit, jamais côté client.
- Isolation par run : héritée du modèle éphémère des runners GitHub-hosted (cf. §3.1) — **à condition de ne jamais introduire de self-hosted runners en V2 sans revoir cette garantie**.
- Isolation multi-tenant : **logique uniquement** pour tous les plans, y compris Enterprise **[DÉCIDÉ]** — pas d'instance physiquement séparée en MVP. L'offre Enterprise se différencie par le SLA/support/priorité de build, pas par l'infrastructure ; le libellé "Infrastructure dédiée" du pricing (§ Pricing du draft original) doit être corrigé en conséquence avant publication commerciale.
- Audit trail : utilisateur, projet, build, date, durée, statut.
- RGPD : résidence des données en UE **[DÉCIDÉ]** (cf. §3.2). Restent à formaliser (hors blocage PRD, à traiter en spec technique) : DPA avec sous-traitants (GitHub, Google/Firebase, Apple), politique de rétention des secrets et des artefacts.

---

## 4. Risques

| Risque | Impact | Mitigation proposée |
|---|---|---|
| Quota GitHub Actions de l'utilisateur insuffisant (surtout macOS ×10) | Échec de build hors contrôle MobileFlow, support burden | Afficher le quota restant avant lancement, documenter clairement dans l'onboarding |
| Files d'attente runners macOS variables | SLA < 8 min iOS difficile à garantir globalement | Clarifier le SLA comme "temps de compilation", pas "temps total" |
| Perte de keystore Android par l'utilisateur | Impossibilité de mettre à jour l'app sur le store | Avertissement fort à l'upload + recommandation de sauvegarde externe |
| Permission GitHub App large (write) perçue comme intrusive | Friction à l'onboarding, méfiance | Écran de consentement explicite détaillant l'usage exact des permissions |
| Expiration silencieuse des certificats Apple | Build échoue au moment du run, sans prévenir en amont (comportement accepté pour le MVP) | Message d'erreur explicite ; alerte proactive différée en V2 |

---

## 5. Décisions d'arbitrage (résumé)

Tous les points ouverts de la v1.1 ont été tranchés :

1. **Gestion d'équipe** — repoussée à Enterprise/V2 ; compte partagé en MVP pour les agences.
2. **Hébergement backend** — région UE obligatoire (RGPD).
3. **Cibles KPI** — validées telles que proposées (§1).
4. **Alerte expiration certificats Apple** — repoussée V2 ; échec explicite au build en MVP.
5. **Logs en temps réel** — repoussés V2 ; post-mortem uniquement en MVP.
6. **Isolation Enterprise** — logique uniquement, pas d'infra physique dédiée ; à corriger dans le pricing commercial ("Infrastructure dédiée" → reformuler en SLA/support prioritaire).

---

## 6. Non Functional Requirements (révisés)

- Disponibilité plateforme (hors exécution GitHub Actions) : 99.9 %
- Temps de **compilation** (hors file d'attente GitHub) : Android < 5 min, iOS < 8 min
- Runners : GitHub-hosted uniquement (pas de self-hosted en MVP, cf. §3.1)
- Multi-tenant, responsive, sauvegarde quotidienne, monitoring temps réel
- RGPD compliant — détails à préciser (§3.4)

---

## 7. Roadmap V2 (inchangé)

Déploiement App Store/Google Play, TestFlight, Internal/Closed Testing, Release Notes IA, versioning automatique, notifications Slack/Discord, API publique, CLI, Build Cache, Expo, Flutter, Bitbucket/GitLab/Azure DevOps, self-hosted Git.

---

## 8. Definition of Done (MVP) — inchangé, avec ajout

1–10. *(cf. draft original, inchangé)*
11. **Ajout** : l'utilisateur voit son quota GitHub Actions restant avant de lancer un build susceptible de le dépasser.
