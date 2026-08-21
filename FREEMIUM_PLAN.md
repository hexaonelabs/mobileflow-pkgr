# Freemium Development Plan - MobileFlow

## Overview

**Goal**: Build premium features that create enough value for users to pay voluntarily, without preventing technical workarounds.

**Strategy**: Features that accumulate value inside the MobileFlow system (analytics, notifications, artifact retention) rather than features that are easy to work around (OTA, hosting). Production builds themselves are also gated server-side (see "Production build gating" below) — unlike a UI-only restriction, this one can't be bypassed by triggering the GitHub Actions workflow directly, because the signing secrets are only ever released through the same plan check.

**Timeline**: 1 prerequisite phase (webhook) + 3 phases, ~4-5 weeks + 1-2 days total for the solid foundation.

> ⚠️ **Technical prerequisite**: `BuildsService.refreshStatus()` is currently only triggered by client-side polling (`setInterval` in `build-detail.ts` / `project-builds.ts`). Without a GitHub webhook, Analytics and Notifications only fire if a user has the app open at the moment the build finishes — which defeats the whole point of Slack notifications. See Phase 0 below, to be handled before or alongside Phase 1.

---

## 📊 Prioritization

| Phase | Feature | Effort | Impact | ROI |
|-------|---------|--------|--------|-----|
| 0 | GitHub webhook (build status reliability) | 1-2d | ⭐⭐⭐⭐ | prerequisite |
| 1 | Light analytics | 3-4d | ⭐⭐⭐ | 💰💰💰 |
| 1 | Slack notifications | 2-3d | ⭐⭐⭐ | 💰💰💰 |
| 1.5 | Production build gating (free plan) | 1d | ⭐⭐⭐⭐ | 💰💰💰 |
| 2 | Artifact retention (time-boxed, auto-delete) | 3-4d | ⭐⭐⭐ | 💰💰 |
| 3 | Webhooks/TestFlight | 3-4d | ⭐⭐⭐ | 💰💰 |
| 3 | Build matrix/batching | 4-5d | ⭐⭐ | 💰 |

> 🚫 **Build scheduling (cron) removed from the plan.** It was gated behind a UI check only — a build triggered by workflow_dispatch runs through the user's own GitHub Actions, so it added no monetization value that production build gating doesn't already provide, at a much higher relative effort (4-5d) for a "convenience" feature most solo/small-team users can live without. Revisit later as a standalone feature if there's demand, not as a monetization lever.

> 🚫 **Team collaboration removed from the plan.** The current model (`ProjectDocument.userId: string`) has no notion of members/roles/invitations, and ownership is checked in a hardcoded (duplicated) way in every service. Selling "team members" tiers before this model exists would be a promise the product can't keep. To be redesigned as its own dedicated project when the time comes (outside this freemium plan).

---

## 🗄️ Data models

### 1. UserPlan (implemented — differs from the original sketch)

`subscription` lives on `UserDocument` as originally planned, but quotas turned out **not** to be per-user — they're a single shared `PlanQuotasDocument`, keyed by plan, auto-seeded on first read:

```typescript
// apps/api/src/users/user.model.ts
interface UserDocument {
  // ... existing
  plan: Plan; // 'free' | 'starter' | 'pro' | 'enterprise'
  billing?: UserBilling; // stripeCustomerId, stripeSubscriptionId, status, currentPeriodEnd
}

// apps/api/src/quotas/plan-quotas.model.ts (shared doc, collection `planQuotas`, id `default`)
interface PlanQuotasDocument {
  free: { projectsLimit: number | null };
  starter: { projectsLimit: number | null };
  pro: { projectsLimit: number | null };
  enterprise: { projectsLimit: number | null };
}
```

Phase 2 (below) extends this same `PlanQuotasDocument` shape with `artifactRetentionDays` per plan — keep new quota fields here, not on `UserDocument`, to stay consistent with what's already shipped.

### 2. BuildAnalytics (new)
```typescript
// apps/api/src/analytics/build-analytics.model.ts

export const ANALYTICS_COLLECTION = 'analytics';

interface BuildAnalyticsDocument {
  userId: string;
  projectId: string;

  // Aggregated monthly
  year: number;
  month: number;

  // Totals
  totalBuilds: number;
  totalSuccessful: number;
  totalFailed: number;
  totalCancelled: number;

  // By platform
  byPlatform: {
    ios: { total: number; successful: number };
    android: { total: number; successful: number };
  };

  // By environment
  byEnvironment: {
    staging: { total: number; successful: number };
    production: { total: number; successful: number };
  };

  // Time series (for trends)
  dailyBreakdown: Array<{
    date: string; // YYYY-MM-DD
    total: number;
    successful: number;
    avgDurationSeconds: number;
  }>;

  // Global stats
  avgDurationSeconds: number;
  successRate: number;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 3. NotificationConfig (new)
```typescript
// apps/api/src/notifications/notification-config.model.ts

export const NOTIFICATION_CONFIGS_COLLECTION = 'notificationConfigs';

interface NotificationConfigDocument {
  userId: string;
  projectId: string;

  slack?: {
    webhookUrl: string;
    enabled: boolean;
    events: ('build.started' | 'build.success' | 'build.failed')[];
  };

  discord?: {
    webhookUrl: string;
    enabled: boolean;
    events: ('build.started' | 'build.success' | 'build.failed')[];
  };

  email?: {
    enabled: boolean;
    events: ('build.success' | 'build.failed')[]; // email only for important events
  };

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

## 🔌 PHASE 0: GitHub Webhook — reliability prerequisite (before Phase 1)

**Problem**: `BuildsService.refreshStatus()` (lines 261-316) is only triggered by client-side polling. If the user closes the tab before the build finishes, the transition to `success/failed` is never captured server-side → Analytics undercounts, and Slack notifications only go out if someone happens to be looking at the dashboard at the right moment.

**Solution**: receive GitHub Actions events via webhook (`workflow_run`, `completed` action) in addition to polling (kept as a UX fallback).

**Good news**: the build ↔ run correlation already exists. The generated workflow defines `run-name: "MobileFlow build ${{ inputs.build_id }} (${{ inputs.platform }})"` (`workflow-template.ts:12`), and `GithubService` already knows how to find a run by `buildId` via `run.name?.includes(buildId)` (`github.service.ts:359`). The webhook can reuse the same rule.

**Files to create**:
- `apps/api/src/github/github-webhook.controller.ts` — public endpoint `POST /github/webhook`
- `apps/api/src/github/github-webhook.service.ts` — signature verification + build/project resolution

**Required refactor**:
- Extract the finalization logic from `refreshStatus()` (status mapping, `finishedAt`/`durationSeconds` computation, Firestore write, idempotency guard `isFinished && !data.finishedAt`) into a shared private method, e.g. `finalizeBuildStatus()`.
- `refreshStatus()` (polling) and the new webhook handler both call `finalizeBuildStatus()` → a single hook point for Analytics and Notifications (Phase 1), guaranteed to fire whether a client is polling or not.

**Webhook logic**:
1. GitHub App configured with a webhook on the `workflow_run` event, shared secret (`GITHUB_WEBHOOK_SECRET`).
2. The controller verifies the HMAC SHA-256 signature (`X-Hub-Signature-256`) before any processing, rejects otherwise (401).
3. If `action !== 'completed'`, ignore.
4. Resolve the project via `repository.full_name` (Firestore lookup on `githubRepoFullName`), derive `userId` and `projectId`.
5. Resolve `buildId` via `workflow_run.name` (same rule as `github.service.ts:359`).
6. Call `finalizeBuildStatus()` with the webhook payload data (no need to call the GitHub API again, everything is already in the payload).

**Checklist**:
- [x] `finalizeBuildStatus()` extracted from `refreshStatus()`, reused as-is
- [ ] Webhook configured on the GitHub App (event `workflow_run`) — external config, confirm in GitHub App settings
- [x] HMAC signature verification (reject if invalid)
- [x] `projectId`/`buildId` resolution via `githubRepoFullName` + `run.name`
- [x] Shared idempotency guard (no double counting if both polling and webhook process the same build)
- [x] Test: build finished with no client connected → `finalizeBuildStatus()` still triggered

---

## 📋 PHASE 1: Light Analytics + Slack Notifications (Week 1-2)

### 1.1 Analytics Backend

**Files to create**:
- `apps/api/src/analytics/analytics.model.ts` - Types
- `apps/api/src/analytics/analytics.service.ts` - Logic
- `apps/api/src/analytics/analytics.controller.ts` - Endpoints
- `apps/api/src/analytics/analytics.module.ts` - Module

**Endpoints**:
```
GET /projects/:id/analytics/summary → current month stats
GET /projects/:id/analytics/trends → last 3 months
GET /projects/:id/analytics/breakdown → by platform/env
```

**Logic**:
1. When `BuildsService.finalizeBuildStatus()` (Phase 0) marks a build as `success/failed/cancelled`, call `AnalyticsService.recordBuild()`
2. `recordBuild()`:
   - Fetches the current month's analytics doc
   - Increments the appropriate counters
   - Recomputes the averages
   - Upserts the document

**Pseudo-code**:
```typescript
// In BuildsService.finalizeBuildStatus() (called by both refreshStatus and the webhook), after the build update:
if (isFinished && !data.finishedAt) {
  // ... update finishedAt, durationSeconds

  this.analyticsService.recordBuild({
    userId, projectId,
    platform: data.platform,
    environment: data.environment,
    status, // success/failed/cancelled
    durationSeconds: update.durationSeconds,
  });
}
```

### 1.2 Slack Notifications Backend

**Files to create**:
- `apps/api/src/notifications/notifications.service.ts` - Sending logic
- `apps/api/src/notifications/notification-config.service.ts` - Manage configs
- `apps/api/src/notifications/notifications.controller.ts` - Endpoints
- `apps/api/src/notifications/notifications.module.ts` - Module

**Endpoints**:
```
POST /projects/:id/notifications/config
  → { slack: { webhookUrl, events } }
GET /projects/:id/notifications/config
  → fetches the current config

POST /projects/:id/notifications/test
  → sends a test message
```

**Logic**:
1. User configures the Slack webhook via the UI
2. `NotificationConfigService.upsert()` → stores it in Firestore
3. In `BuildsService.finalizeBuildStatus()` (Phase 0), call `NotificationsService.onBuildStatusChanged()`
4. `onBuildStatusChanged()`:
   - Fetches the project's Slack config
   - If the event is in the list to notify, sends the message
   - Uses a queue (`BullMQ`) to retry on failure

**Email**: no third-party provider (SendGrid/Resend). Sent via SMTP (`nodemailer`) from an address on the server's own domain — hosting for this SMTP account (Infomaniak VPS or Firebase Function) is not decided yet, to be revisited separately before implementing `handleEmailNotification`.

**Pseudo-code**:
```typescript
// In notifications.service.ts
async sendSlackNotification(
  config: NotificationConfig,
  event: BuildStatusChangedEvent,
) {
  // Create a job in the queue
  await this.notificationQueue.add('slack-notification', {
    webhookUrl: config.slack.webhookUrl,
    event,
  });
}

// Job handler (worker)
@Process('slack-notification')
async handleSlackNotification(job: Job) {
  const { webhookUrl, event } = job.data;
  const message = this.formatSlackMessage(event);
  await axios.post(webhookUrl, message);
}
```

### 1.3 Frontend - Analytics Dashboard

**Files to create**:
- `apps/web/src/app/features/projects/analytics/analytics.ts` - Page
- `apps/web/src/app/features/projects/analytics/analytics-summary.ts` - Summary widget
- `apps/web/src/app/features/projects/analytics/analytics-chart.ts` - Charts (trends)

**UI**:
```
┌─────────────────────────┐
│ Analytics               │
├─────────────────────────┤
│ Total: 42 builds        │
│ Success rate: 95%       │
│ Avg duration: 8m 30s    │
├─────────────────────────┤
│ [Trends Chart]          │ (last 30 days)
│ Builds per day          │
│                         │
├─────────────────────────┤
│ By Platform:            │
│ iOS: 25 (23 success)    │
│ Android: 17 (16 success)│
└─────────────────────────┘
```

**Logic**:
- Call `GET /projects/:id/analytics/summary` on load
- For trends, call `GET /projects/:id/analytics/trends`
- Use a chart library (Chart.js, to be installed)

### 1.4 Frontend - Slack Config UI

**Files to create**:
- `apps/web/src/app/features/projects/notifications/notifications-config.ts` - Page
- `apps/web/src/app/features/projects/notifications/slack-config-form.ts` - Form

**UI**:
```
┌──────────────────────────────────┐
│ Notifications Configuration      │
├──────────────────────────────────┤
│ Slack Webhook URL:               │
│ [https://hooks.slack.com/...   ] │
│                                  │
│ Events:                          │
│ ☑ Build started                  │
│ ☑ Build succeeded                │
│ ☑ Build failed                   │
│                                  │
│ [Test Message] [Save Changes]    │
└──────────────────────────────────┘
```

**Logic**:
- POST webhook URL → `POST /projects/:id/notifications/config`
- On save, show a confirmation
- "Test Message" → `POST /projects/:id/notifications/test`

### 1.5 Production Build Gating (implemented, outside the original phasing)

Rather than build scheduling, the conversion lever we actually shipped: `BuildsService.create()` (`apps/api/src/builds/builds.service.ts`) now rejects `environment: 'production'` for `plan === 'free'` with a `ForbiddenException`, before any call to GitHub. Frontend (`project-build-new.ts`) shows an inline warning + disables the submit button as soon as "Production" is selected while on the Free plan, with the real API error surfaced on submit as a fallback.

**Why this can't be bypassed by triggering the GitHub Actions workflow manually**: signing secrets (iOS certificate always, Android keystore in production) are never in the repo — they're fetched at runtime via a short-lived, single-use `secrets_token` minted only by `BuildsService.create()`. No token, no signed artifact, regardless of how the workflow is triggered. See `RunTokensService` (`apps/api/src/internal/run-tokens.service.ts`) and `InternalSecretsController` (`apps/api/src/internal/internal-secrets.controller.ts`).

**Known scope limit**: iOS signs Ad Hoc "always" today (`workflow-template.ts:6`) — there's no separate App Store distribution certificate yet, so an iOS "production" build isn't actually store-submittable yet regardless of plan. Real App Store signing is a separate piece of work, not covered by this gate.

---

## 🔒 PHASE 2: Artifact Retention (time-boxed, auto-delete)

**Scope constraint to keep in mind**: today, `BuildsService.ensureHostedArtifact()` only ever uploads to Firebase Storage for **staging** builds (`environment !== staging` throws `BadRequestException`) — that's the OTA/Ad Hoc install path. Production artifacts are never copied into MobileFlow's own storage; they only exist as GitHub Actions run artifacts, subject to GitHub's own retention window, which this system doesn't control. So this phase's retention/auto-delete governs **staging artifacts hosted for OTA install**, not production ones — extending real retention control to production would first require hosting production artifacts too (a separate decision, not assumed here).

### 2.1 Data model changes

- `apps/api/src/quotas/plan-quotas.model.ts` (`PlanQuotasDocument`): add `artifactRetentionDays: number | null` per plan — `free: 7, starter: 30, pro: 90` (mirrors the original pricing promise), `null` = unlimited.
- `apps/api/src/builds/build.model.ts` (`BuildDocument`): add `artifactUploadedAt: Timestamp | null`. This is the retention anchor — **not** `createdAt`, since hosting is lazy/on-demand (a build can exist for weeks before anyone clicks "Install"). Set it in `ensureHostedArtifact()` alongside `artifactStoragePath`.

### 2.2 Backend

- `StorageService` (`apps/api/src/storage/storage.service.ts`): add `deleteFile(path: string): Promise<void>` — doesn't exist today (only `uploadBuffer`/`getSignedDownloadUrl`).
- New `ArtifactRetentionService.purgeExpiredArtifacts()`: for each build with `artifactStoragePath != null`, look up the owning user's current plan (evaluated live, same philosophy as `ProjectsService.getQuotaUsage` — not locked in at upload time, so a downgrade shortens retention going forward), compute the cutoff from `artifactUploadedAt`, delete the Storage file + clear `artifactStoragePath`/`artifactUploadedAt` on expiry.
- **Scheduling**: prefer a **BullMQ repeatable job** over `@nestjs/schedule`. Redis/BullMQ is already wired up for notifications; a plain `@Cron()` would fire once per running API instance if the API is ever scaled horizontally, causing redundant delete attempts. BullMQ repeatable jobs are deduplicated across instances.
- No new user-facing endpoint is required for the deletion itself — it's a background sweep. Worth exposing "expires in N days" wherever the artifact/install link is shown, computed client-side from `artifactUploadedAt + retentionDays`.

### 2.3 Frontend

- `build-detail`: show "Available until <date>" once hosted; if already purged, replace the "Install" button with a clear message instead of a broken link. Re-clicking "Install" can safely re-trigger `ensureHostedArtifact()` (already idempotent), but it now also needs to handle the case where the underlying GitHub Actions artifact itself has since expired (build fails with a clear error instead of a silent failure).

### 2.4 Tests

- Unit: the "is this build's artifact expired" pure function (plan × `artifactUploadedAt` × now)
- Unit: `purgeExpiredArtifacts()` against a mixed set of builds/plans/ages (mock `StorageService`/Firestore)
- Unit: `StorageService.deleteFile()` (mocked GCS call)
- E2E: run the sweep, assert the Storage delete + Firestore update happened only for the expired build, not the fresh one

---

## 💰 Pricing

```json
{
  "free": {
    "price": "$0",
    "features": [
      "Unlimited staging builds (GitHub Actions, Ad Hoc install)",
      "Production builds not included — server-side gated, see Phase 1.5",
      "Analytics (view only, current month)",
      "Email notifications (failed builds only)",
      "Staging artifacts kept 7 days",
      "3 projects max"
    ]
  },
  "starter": {
    "price": "$9/month",
    "features": [
      "Everything in Free, plus:",
      "Production builds (App Store / Play Store publishing)",
      "Slack notifications (all events — Discord config stored but delivery not implemented yet)",
      "Staging artifacts kept 30 days",
      "20 projects"
    ]
  },
  "pro": {
    "price": "$19/month",
    "features": [
      "Everything in Starter, plus:",
      "Unlimited projects",
      "Staging artifacts kept 90 days",
      "Webhooks (TestFlight, Sentry, S3)",
      "Advanced analytics (trends, breakdowns)",
      "Priority support"
    ]
  }
}
```

---

## 🚦 Implementation checklist

### Phase 0 - GitHub Webhook (prerequisite)
- [x] Extract `finalizeBuildStatus()` from `refreshStatus()` in `BuildsService`
- [x] Create `github-webhook.controller.ts` + `github-webhook.service.ts`
- [ ] Configure the webhook on the GitHub App (event `workflow_run`) + secret — **external config, not verifiable from the repo; confirm in the GitHub App settings before relying on it in production**
- [x] HMAC signature verification
- [x] Tests: build finalized server-side with no client connected (`github-webhook.e2e-spec.ts`, plus the concurrent webhook/polling regression test in `builds.service.spec.ts`)

### Phase 1.1 - Analytics Service
- [x] Create `analytics.model.ts` with BuildAnalyticsDocument
- [x] Create `analytics.service.ts` with methods:
  - `recordBuild(userId, projectId, buildInfo)`
  - `getSummary(userId, projectId)`
  - `getTrends(userId, projectId)`
  - `getBreakdown(userId, projectId)`
- [x] Integrate into `builds.service.ts` → call `recordBuild()` when status changes
- [x] Create `analytics.controller.ts` with GET endpoints
- [x] Unit tests + E2E

### Phase 1.2 - Notifications Service
- [x] Create `notification-config.model.ts`
- [x] Create `notification-config.service.ts` (CRUD)
- [x] Create `notifications.service.ts` with:
  - `sendSlackNotification(config, event)`
  - ~~`sendDiscordNotification(config, event)`~~ — config storage exists (`notification-config.model.ts`), delivery not implemented; `notifications.processor.ts` only dispatches `slack-notification` and `email-notification` jobs
  - `sendEmailNotification(email, event)`
  - Job handlers for BullMQ
- [x] Integrate into `builds.service.ts` → emit event on build status change
- [x] Create `notifications.controller.ts` with POST endpoints
- [x] Tests + E2E

### Phase 1.3 - Analytics Frontend
- [x] Create `analytics.ts` component
- [x] Create `analytics-summary.ts` component (cards)
- [x] Create `analytics-charts.ts` component (trends)
- [x] Add route in `app.routes.ts`
- [ ] Tests — no `.spec.ts` yet for any analytics frontend component

### Phase 1.4 - Notifications Frontend
- [x] Create `notifications-config.ts` page
- [x] Create `slack-config-form.ts` form
- [x] API wrapper service
- [x] Add route
- [ ] Tests — no `.spec.ts` yet for either notifications frontend component

### Phase 1.5 - Plan Check & Gating
- [x] ~~Modify `users.service.ts` → add `getPlan(userId)`~~ — done differently: plan is read directly off the JWT payload (`AuthenticatedUser.plan`), no dedicated `getPlan()` method needed
- [x] Create `plan.guard.ts` (NestJS guard) for premium endpoints — actual shape differs from the sketch below, uses a decorator + `Reflector` instead of a guard factory:
  ```typescript
  @UseGuards(PlanGuard)
  @RequirePlan(Plan.starter)
  @Post(':id/notifications/config')
  ```
- [x] Production build gating for the Free plan (`BuildsService.create()`) — not in the original phasing, added as the stronger alternative to build scheduling, see Phase 1.5 narrative above
- [ ] Frontend: show "Premium feature" lock if the user is on Free — done for the production-build gate (`project-build-new.ts`) only; notifications/analytics endpoints are still blocked API-side with no UI lock (per note #3 below, intentional for now)

### Phase 2
- [ ] See the detailed Phase 2 checklist above (2.1-2.4)

### Phase 3
- [ ] Depends on Phase 1/2, similar steps

---

## 🔧 Key integration points

### BuildsService (changes)
1. Line 261-316 (`refreshStatus`): extract the finalization logic into `finalizeBuildStatus()` (Phase 0), called by both polling and the webhook
2. `finalizeBuildStatus()` directly calls `AnalyticsService` and `NotificationsService` (no EventEmitter, decision already made: direct call via injection)

### GithubModule (changes)
1. New `GithubWebhookController` (`POST /github/webhook`, public, signature verified)
2. Factor out the `githubRepoFullName → projectId/userId` resolution if it already exists elsewhere, otherwise create it in `github-webhook.service.ts`

### Modules to create
1. `AnalyticsModule` → export AnalyticsService
2. `NotificationsModule` → export NotificationsService, NotificationConfigService
3. `ArtifactRetentionModule` (Phase 2)

### App.module.ts
Add the new modules

### Firestore migrations
If needed, create a migration script to add fields to users

---

## 🧪 Test strategy

**Unit tests**:
- AnalyticsService (recordBuild, getSummary, etc.)
- NotificationConfigService (CRUD)
- NotificationsService (formatting, queue integration)

**E2E tests**:
- POST build → verifies analytics were incremented
- POST build → verifies the Slack webhook was called (mock)
- POST notifications config → verifies storage

**Frontend tests**:
- Analytics page loads and displays data
- Notifications config form validates and sends POST

---

## 📈 Success metrics

**Phase 1**:
- [ ] Analytics page displays correct numbers
- [ ] Slack notifications received within 5 sec of a build status change
- [ ] Clear free vs premium UI

**Phase 2**:
- [ ] Artifacts past their plan's retention window are deleted automatically, on-schedule, with no manual intervention
- [ ] A user's artifacts still within the retention window are never touched by the sweep

**Conversion**:
- [ ] Measure: % of users who enable Slack → engagement indicator
- [ ] Measure: retention after 30 days of usage

---

## 💬 Notes for the agent

1. **Start with Phase 0** (GitHub Webhook) → prerequisite, otherwise Analytics/Notifications only fire if a client is actively polling the build
2. **Then Phase 1.1** (Analytics) → the foundation for the following features
3. **No premium UI gating at first** → everything stays visible, only endpoints are blocked on the API side
4. **BullMQ is already set up** → use it for async notifications
5. **Firebase Firestore is already configured** → create collections directly
6. **Email via SMTP, no third-party provider** → use `nodemailer` with an SMTP account on the server's domain. Hosting (Infomaniak VPS or Firebase Function) is not decided yet — to be revisited separately before implementing `handleEmailNotification`, don't let it block the rest of Phase 1.
7. **Team collaboration removed from the plan** → don't implement a `teamMembersLimit` quota or "team members" pricing, the current ownership model is single-user (`ProjectDocument.userId`)
8. **Tests first** → no feature ships without tests
9. **Git**: create feature branches, atomic commits per feature (webhook, then analytics, then notifications, etc.)
