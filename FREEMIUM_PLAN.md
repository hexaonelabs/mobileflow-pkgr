# Freemium Development Plan - MobileFlow

## Overview

**Goal**: Build premium features that create enough value for users to pay voluntarily, without preventing technical workarounds.

**Strategy**: Features that accumulate value inside the MobileFlow system (analytics, notifications, scheduling) rather than features that are easy to work around (OTA, hosting).

**Timeline**: 1 prerequisite phase (webhook) + 3 phases, ~4-5 weeks + 1-2 days total for the solid foundation.

> ⚠️ **Technical prerequisite**: `BuildsService.refreshStatus()` is currently only triggered by client-side polling (`setInterval` in `build-detail.ts` / `project-builds.ts`). Without a GitHub webhook, Analytics and Notifications only fire if a user has the app open at the moment the build finishes — which defeats the whole point of Slack notifications. See Phase 0 below, to be handled before or alongside Phase 1.

---

## 📊 Prioritization

| Phase | Feature | Effort | Impact | ROI |
|-------|---------|--------|--------|-----|
| 0 | GitHub webhook (build status reliability) | 1-2d | ⭐⭐⭐⭐ | prerequisite |
| 1 | Light analytics | 3-4d | ⭐⭐⭐ | 💰💰💰 |
| 1 | Slack notifications | 2-3d | ⭐⭐⭐ | 💰💰💰 |
| 2 | Artifact versioning | 2d | ⭐⭐ | 💰💰 |
| 2 | Build scheduling (cron) | 4-5d | ⭐⭐⭐⭐ | 💰💰💰 |
| 3 | Webhooks/TestFlight | 3-4d | ⭐⭐⭐ | 💰💰 |
| 3 | Build matrix/batching | 4-5d | ⭐⭐ | 💰 |

> 🚫 **Team collaboration removed from the plan.** The current model (`ProjectDocument.userId: string`) has no notion of members/roles/invitations, and ownership is checked in a hardcoded (duplicated) way in every service. Selling "team members" tiers before this model exists would be a promise the product can't keep. To be redesigned as its own dedicated project when the time comes (outside this freemium plan).

---

## 🗄️ Data models

### 1. UserPlan (already exists, to extend)
```typescript
// apps/api/src/users/user.model.ts

// To add to UserDocument:
interface UserDocument {
  // ... existing
  plan: Plan; // 'free' | 'starter' | 'pro' | 'enterprise'

  // To add:
  subscription?: {
    stripeId?: string;
    status: 'active' | 'cancelled' | 'past_due';
    currentPeriodEnd?: Timestamp;
  };
  quotas?: {
    projectsLimit: number;        // free: 3, starter: 20, pro: unlimited
    artifactRetentionDays: number; // free: 7, starter: 30, pro: 90
    monthlyWebhookCalls: number;  // free: 0, starter: 100, pro: unlimited
  };
}
```

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

### 4. BuildSchedule (new, for Phase 2)
```typescript
// apps/api/src/schedules/build-schedule.model.ts

export const BUILD_SCHEDULES_COLLECTION = 'buildSchedules';

interface BuildScheduleDocument {
  userId: string;
  projectId: string;

  name: string; // "Daily staging build"
  cronExpression: string; // "0 0 * * *" (midnight)

  buildConfig: {
    branch: string;
    environment: Environment;
    platforms: Platform[];
    envVars?: Record<string, string>;
  };

  enabled: boolean;
  lastRun?: Timestamp;
  nextRun?: Timestamp;

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
- [ ] `finalizeBuildStatus()` extracted from `refreshStatus()`, reused as-is
- [ ] Webhook configured on the GitHub App (event `workflow_run`)
- [ ] HMAC signature verification (reject if invalid)
- [ ] `projectId`/`buildId` resolution via `githubRepoFullName` + `run.name`
- [ ] Shared idempotency guard (no double counting if both polling and webhook process the same build)
- [ ] Test: build finished with no client connected → `finalizeBuildStatus()` still triggered

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

---

## 🔔 PHASE 2: Artifact Versioning + Build Scheduling (Week 3)

### 2.1 Artifact Versioning

**Backend changes**:
- Modify `BuildDocument` to track artifactVersions
- `BuildsService.ensureHostedArtifact()` → stop deleting old artifacts
- New endpoint: `GET /projects/:id/builds/artifacts/archive` → list all artifacts

**Frontend**:
- In `build-detail`, display "Artifact versions"
- Allow downloading/restoring a previous version

### 2.2 Build Scheduling (Cron)

**Backend**:
- Service: `SchedulesService` → schedules CRUD
- Worker: polling/cron that triggers builds automatically
- Use `node-cron` or a Redis ZSET for scheduling

**Frontend**:
- New "Schedules" page in project detail
- Form to create a cron job
- Display execution history

---

## 💰 Pricing

```json
{
  "free": {
    "price": "$0",
    "features": [
      "Unlimited builds (GitHub Actions)",
      "Analytics (view only, current month)",
      "Email notifications (failed builds only)",
      "3 projects max"
    ]
  },
  "starter": {
    "price": "$9/month",
    "features": [
      "Everything in Free, plus:",
      "Slack/Discord notifications (all events)",
      "Artifact archive (30 days)",
      "20 projects"
    ]
  },
  "pro": {
    "price": "$19/month",
    "features": [
      "Everything in Starter, plus:",
      "Unlimited projects",
      "Build scheduling (cron)",
      "Artifact archive (90 days)",
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
- [ ] Extract `finalizeBuildStatus()` from `refreshStatus()` in `BuildsService`
- [ ] Create `github-webhook.controller.ts` + `github-webhook.service.ts`
- [ ] Configure the webhook on the GitHub App (event `workflow_run`) + secret
- [ ] HMAC signature verification
- [ ] Tests: build finalized server-side with no client connected

### Phase 1.1 - Analytics Service
- [ ] Create `analytics.model.ts` with BuildAnalyticsDocument
- [ ] Create `analytics.service.ts` with methods:
  - `recordBuild(userId, projectId, buildInfo)`
  - `getSummary(userId, projectId)`
  - `getTrends(userId, projectId)`
  - `getBreakdown(userId, projectId)`
- [ ] Integrate into `builds.service.ts` → call `recordBuild()` when status changes
- [ ] Create `analytics.controller.ts` with GET endpoints
- [ ] Unit tests + E2E

### Phase 1.2 - Notifications Service
- [ ] Create `notification-config.model.ts`
- [ ] Create `notification-config.service.ts` (CRUD)
- [ ] Create `notifications.service.ts` with:
  - `sendSlackNotification(config, event)`
  - `sendDiscordNotification(config, event)`
  - `sendEmailNotification(email, event)`
  - Job handlers for BullMQ
- [ ] Integrate into `builds.service.ts` → emit event on build status change
- [ ] Create `notifications.controller.ts` with POST endpoints
- [ ] Tests + E2E

### Phase 1.3 - Analytics Frontend
- [ ] Create `analytics.ts` component
- [ ] Create `analytics-summary.ts` component (cards)
- [ ] Create `analytics-chart.ts` component (trends)
- [ ] Add route in `project-shell.ts`
- [ ] Tests

### Phase 1.4 - Notifications Frontend
- [ ] Create `notifications-config.ts` page
- [ ] Create `slack-config-form.ts` form
- [ ] API wrapper service
- [ ] Add route
- [ ] Tests

### Phase 1.5 - Plan Check & Gating
- [ ] Modify `users.service.ts` → add `getPlan(userId)`
- [ ] Create `plan.guard.ts` (NestJS guard) for premium endpoints
  ```typescript
  @UseGuards(JwtAuthGuard, PlanGuard('starter'))
  @Post(':id/notifications/config')
  ```
- [ ] Frontend: show "Premium feature" lock if the user is on Free

### Phase 2 & 3
- [ ] Depends on Phase 1, similar steps

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
3. `SchedulesModule` (Phase 2)

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
- [ ] Build scheduling works (cron tests)
- [ ] Artifact versioning tested

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
