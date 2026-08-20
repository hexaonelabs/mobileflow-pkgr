# Phase 1: Analytics + Notifications Implementation

## 📌 Overview

**Estimated duration**: 6-8 days (including 1-2 days of webhook prerequisite)
**Dependencies**: None (solid base)
**Order**:
0. GitHub Webhook — reliable build-finish detection (1-2d)
1. Data models (1h)
2. Analytics Service (1-2d)
3. Notifications Service (1-2d)
4. Frontend Analytics (1d)
5. Frontend Notifications Config (1d)
6. Plan gating + tests (1d)

> ⚠️ **Why Step 0 comes before everything else**: `BuildsService.refreshStatus()` (`apps/api/src/builds/builds.service.ts:261-316`) is currently only triggered by client-side polling (`setInterval` in `build-detail.ts:308` and `project-builds.ts:402`). If nobody has the app open when the build finishes, nothing happens server-side. Analytics and Notifications are hooked into this trigger point — without a fix, Slack notifications (the flagship paid feature) would only fire if someone happens to be watching the dashboard, which defeats their purpose.

---

## 🔌 STEP 0: GitHub Webhook (reliability prerequisite)

### Task 0.1: Extract `finalizeBuildStatus()` from `refreshStatus()`

**File**: `apps/api/src/builds/builds.service.ts`

**Current context** (lines 261-316): `refreshStatus()` does everything in one shot — resolves the GitHub run, maps the status, computes `finishedAt`/`durationSeconds`, writes to Firestore. We need to isolate the "finalization" part (from the point where we have a `status` and a `run`) into a reusable private method, callable from both polling and the future webhook.

```typescript
// New private method, extracted from the body of refreshStatus() (lines ~287-315)
private async finalizeBuildStatus(
  userId: string,
  projectId: string,
  buildId: string,
  ref: FirebaseFirestore.DocumentReference,
  data: BuildDocument,
  run: { status: string | null; conclusion: string | null; htmlUrl: string; startedAt: string | null; updatedAt: string },
) {
  const status = this.mapRunStatus(run.status, run.conclusion);
  const update: Partial<BuildDocument> = { status, logsUrl: run.htmlUrl };

  if (status === BuildStatus.running && !data.startedAt) {
    update.startedAt = FieldValue.serverTimestamp();
  }
  const isFinished =
    status === BuildStatus.success ||
    status === BuildStatus.failed ||
    status === BuildStatus.cancelled;

  if (isFinished && !data.finishedAt) {
    update.finishedAt = FieldValue.serverTimestamp();
    if (run.startedAt) {
      const durationMs = new Date(run.updatedAt).getTime() - new Date(run.startedAt).getTime();
      update.durationSeconds = Math.max(0, Math.round(durationMs / 1000));
    }

    // Idempotency guard: this block only runs once per build,
    // whether polling or the webhook wins the race.
    // This is WHERE (and nowhere else) Analytics (Step 2)
    // and Notifications (Step 3) will hook in.
  }
  if (status === BuildStatus.success && !data.artifactUrl) {
    update.artifactUrl = await this.githubService.findArtifactUrl(
      userId,
      (await this.getOwnedProject(userId, projectId)).githubRepoFullName,
      data.githubRunId!,
      `mobileflow-${buildId}-${data.platform}`,
    );
  }

  await ref.update(update);
  const refreshed = await ref.get();
  return { isFinished: isFinished && !data.finishedAt, build: this.toApiBuild(buildId, refreshed.data() as BuildDocument), update };
}
```

`refreshStatus()` becomes a simple caller:
```typescript
async refreshStatus(userId: string, projectId: string, buildId: string) {
  // ... run resolution as today (lines 261-286, unchanged) ...
  const run = await this.githubService.getWorkflowRun(userId, project.githubRepoFullName, runId);
  const { build } = await this.finalizeBuildStatus(userId, projectId, buildId, ref, data, run);
  return build;
}
```

**Checklist**:
- [x] `finalizeBuildStatus()` created, logic identical to the existing one (no behavior regression)
- [x] `refreshStatus()` refactored to call it
- [x] Existing tests on `refreshStatus()` still pass (no pre-existing spec for this file; new coverage added in Task 0.6)

---

### Task 0.2: Create `GithubWebhookController`

**File**: `apps/api/src/github/github-webhook.controller.ts`

```typescript
import { BadRequestException, Controller, Headers, Post, RawBodyRequest, Req } from '@nestjs/common';
import type { Request } from 'express';
import { GithubWebhookService } from './github-webhook.service';

@Controller('github')
export class GithubWebhookController {
  constructor(private readonly webhookService: GithubWebhookService) {}

  @Post('webhook')
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') event: string | undefined,
  ) {
    if (!signature || !req.rawBody) {
      throw new BadRequestException('Missing signature');
    }
    this.webhookService.verifySignature(req.rawBody, signature);

    if (event !== 'workflow_run') {
      return { ignored: true };
    }
    await this.webhookService.handleWorkflowRunEvent(req.body);
    return { ok: true };
  }
}
```

**Note**: requires `rawBody: true` in `NestFactory.create()` (`main.ts`) to be able to verify the HMAC signature against the raw body — otherwise a body that's already been JSON-parsed won't match the signature.

**Checklist**:
- [x] Public endpoint `POST /github/webhook` created
- [x] `rawBody` enabled in `main.ts` if not already
- [x] Rejects if signature is missing/invalid (400/401) (missing → 400 here; invalid → 401 in `GithubWebhookService.verifySignature`, Task 0.3)
- [x] Ignores events other than `workflow_run`

---

### Task 0.3: Create `GithubWebhookService`

**File**: `apps/api/src/github/github-webhook.service.ts`

**Responsibilities**:
- Verify the HMAC SHA-256 signature with `GITHUB_WEBHOOK_SECRET`
- Resolve `projectId`/`userId` from `repository.full_name`
- Resolve `buildId` from `workflow_run.name` — same rule as `GithubService.findWorkflowRunId` (`github.service.ts:359`, which already does `run.name?.includes(buildId)`), since the generated workflow defines `run-name: "MobileFlow build ${{ inputs.build_id }} (...)"` (`workflow-template.ts:12`)
- Call `BuildsService.finalizeBuildStatus()` (method made accessible, Task 0.1) with the payload data

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirestoreService } from '../firestore/firestore.service';
import { BUILDS_COLLECTION, type BuildDocument } from '../builds/build.model';
import { PROJECTS_COLLECTION, type ProjectDocument } from '../projects/project.model';
import { BuildsService } from '../builds/builds.service';

@Injectable()
export class GithubWebhookService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly buildsService: BuildsService,
    private readonly config: ConfigService,
  ) {}

  verifySignature(rawBody: Buffer, signatureHeader: string) {
    const secret = this.config.getOrThrow<string>('GITHUB_WEBHOOK_SECRET');
    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid signature');
    }
  }

  async handleWorkflowRunEvent(payload: any) {
    if (payload.action !== 'completed') return;

    const repoFullName: string = payload.repository.full_name;
    const runName: string = payload.workflow_run.name ?? '';

    const projectSnap = await this.firestore.db
      .collection(PROJECTS_COLLECTION)
      .where('githubRepoFullName', '==', repoFullName)
      .limit(1)
      .get();
    if (projectSnap.empty) return; // repo not (or no longer) linked to a MobileFlow project

    const projectDoc = projectSnap.docs[0];
    const project = projectDoc.data() as ProjectDocument;
    const projectId = projectDoc.id;

    const buildsSnap = await this.firestore.db
      .collection(BUILDS_COLLECTION)
      .where('projectId', '==', projectId)
      .where('status', 'in', ['pending', 'running'])
      .get();
    const buildDoc = buildsSnap.docs.find((d) => runName.includes(d.id));
    if (!buildDoc) return; // no pending MobileFlow build matches this run

    await this.buildsService.finalizeBuildStatus(
      project.userId,
      projectId,
      buildDoc.id,
      buildDoc.ref,
      buildDoc.data() as BuildDocument,
      {
        status: payload.workflow_run.status,
        conclusion: payload.workflow_run.conclusion,
        htmlUrl: payload.workflow_run.html_url,
        startedAt: payload.workflow_run.run_started_at,
        updatedAt: payload.workflow_run.updated_at,
      },
    );
  }
}
```

**Checklist**:
- [x] HMAC verification with `timingSafeEqual` (no naive string comparison)
- [x] Project resolution by `githubRepoFullName`
- [x] Build resolution by matching `run.name` (reuses the rule from `github.service.ts:359`)
- [x] Call to `finalizeBuildStatus()` (made `public` on `BuildsService`, Task 0.1)
- [x] Tests: valid `workflow_run.completed` payload → build finalized; invalid signature → rejected (Task 0.6)

---

### Task 0.4: Configure the webhook on the GitHub App

- Add the `Workflow runs` event in the GitHub App settings (or the repo's webhook if managed per installation)
- Generate a secret, add it as env variable `GITHUB_WEBHOOK_SECRET` (API + secret manager)
- Point the URL to `https://<api-domain>/github/webhook`

**Checklist**:
- [x] `workflow_run` event enabled on the GitHub App (done manually by the user)
- [x] `GITHUB_WEBHOOK_SECRET` configured locally (`.env`) — confirmed working end-to-end (signature verified); prod value still to be set at deploy time
- [x] Manual test: trigger a real build, verify the webhook is received in the logs — confirmed via ngrok inspector: `POST /github/webhook` → `201 {"ok":true}`

---

### Task 0.5: Create `GithubWebhookModule` (or integrate into `GithubModule`)

**File**: `apps/api/src/github/github.module.ts` (update) or a new dedicated module

```typescript
@Module({
  imports: [FirestoreModule, forwardRef(() => BuildsModule)],
  controllers: [GithubWebhookController],
  providers: [GithubWebhookService],
})
```

**Circular dependency warning**: `GithubWebhookService` depends on `BuildsService`, and `BuildsModule` already imports `GithubModule` (for `GithubService`). Use `forwardRef()` on both sides, or extract `GithubWebhookController`/`Service` into a separate module that imports `BuildsModule` without `BuildsModule` needing to import it back.

**Checklist**:
- [x] No circular dependency at startup (`nest start` runs cleanly — verified: "Nest application successfully started" with `GithubWebhookModule dependencies initialized`)
- [x] Module declared in `app.module.ts`

---

## 🎯 STEP 1: Data models (Backend)

### Task 1.1: Create BuildAnalyticsDocument

**File**: `apps/api/src/analytics/build-analytics.model.ts`

```typescript
import type { FieldValue, Timestamp } from 'firebase-admin/firestore';

export const ANALYTICS_COLLECTION = 'analytics';

export interface BuildAnalyticsDocument {
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

  // Daily breakdown (last 30 days, for trends)
  dailyBreakdown: Array<{
    date: string; // YYYY-MM-DD
    total: number;
    successful: number;
    avgDurationSeconds: number;
  }>;

  // Global stats
  avgDurationSeconds: number;
  successRate: number; // 0-100

  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

// DTOs for API responses
export interface AnalyticsSummaryResponse extends Omit<BuildAnalyticsDocument, 'createdAt' | 'updatedAt' | 'dailyBreakdown'> {
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AnalyticsTrendsResponse {
  months: Array<{
    year: number;
    month: number;
    total: number;
    successful: number;
    successRate: number;
  }>;
}

export interface AnalyticsBreakdownResponse {
  platform: { ios: { count: number; rate: number }; android: { count: number; rate: number } };
  environment: { staging: { count: number; rate: number }; production: { count: number; rate: number } };
}
```

**Checklist**:
- [x] File created
- [x] Correct TypeScript types
- [x] Import Firebase/Firestore types

---

### Task 1.2: Create NotificationConfigDocument

**File**: `apps/api/src/notifications/notification-config.model.ts`

```typescript
import type { FieldValue, Timestamp } from 'firebase-admin/firestore';

export const NOTIFICATION_CONFIGS_COLLECTION = 'notificationConfigs';

export type NotificationEvent = 'build.started' | 'build.success' | 'build.failed';

export interface NotificationConfigDocument {
  userId: string;
  projectId: string;

  slack?: {
    webhookUrl: string;
    enabled: boolean;
    events: NotificationEvent[];
  };

  discord?: {
    webhookUrl: string;
    enabled: boolean;
    events: NotificationEvent[];
  };

  email?: {
    enabled: boolean;
    events: ('build.success' | 'build.failed')[]; // Email only for important events
  };

  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}

// DTOs
export interface UpsertNotificationConfigDto {
  slack?: {
    webhookUrl: string;
    enabled: boolean;
    events: NotificationEvent[];
  };
}

export interface NotificationConfigResponse extends Omit<NotificationConfigDocument, 'createdAt' | 'updatedAt'> {
  createdAt: string | null;
  updatedAt: string | null;
}
```

**Checklist**:
- [x] File created
- [x] DTOs for the API
- [x] Event types

---

### Task 1.3: Create BuildStatusChangedEvent

**File**: `apps/api/src/builds/events/build-status-changed.event.ts`

```typescript
import type { BuildStatus, Environment, Platform } from '../build.model';

export class BuildStatusChangedEvent {
  constructor(
    readonly buildId: string,
    readonly projectId: string,
    readonly userId: string,
    readonly platform: Platform,
    readonly environment: Environment,
    readonly status: BuildStatus,
    readonly durationSeconds: number | null,
    readonly previousStatus?: BuildStatus,
  ) {}
}
```

**Checklist**:
- [x] File created
- [x] Correct types

---

## 🔧 STEP 2: Analytics Service

### Task 2.1: Create AnalyticsService

**File**: `apps/api/src/analytics/analytics.service.ts`

**Responsibilities**:
- `recordBuild()`: record a completed build in analytics
- `getSummary()`: current month stats
- `getTrends()`: last 3 months
- `getBreakdown()`: by platform/environment

**Structure**:
```typescript
import { Injectable } from '@nestjs/common';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { FirestoreService } from '../firestore/firestore.service';
import { Platform } from '../projects/project.model';
import { BuildStatus, Environment } from '../builds/build.model';
import { ANALYTICS_COLLECTION, type BuildAnalyticsDocument } from './build-analytics.model';

@Injectable()
export class AnalyticsService {
  constructor(private readonly firestore: FirestoreService) {}

  private get analyticsCollection() {
    return this.firestore.db.collection(ANALYTICS_COLLECTION);
  }

  async recordBuild(
    userId: string,
    projectId: string,
    data: {
      platform: Platform;
      environment: Environment;
      status: BuildStatus;
      durationSeconds: number | null;
    },
  ) {
    // Logic: fetch the month's analytics doc, increment counters, recompute averages
    // 1. Determine current year/month
    // 2. Fetch the analytics doc for userId+projectId+year+month
    // 3. Increment totalBuilds, totalSuccessful/Failed/Cancelled
    // 4. Increment byPlatform[platform].total and .successful (if status=success)
    // 5. Increment byEnvironment[env].total and .successful (if status=success)
    // 6. Update today's entry in dailyBreakdown inside a Firestore TRANSACTION
    //    (runTransaction): read the doc, update the array in memory, write it back.
    //    ⚠️ Do NOT do a plain read-then-write outside a transaction: if two builds
    //    finish the same day a few seconds apart (webhook + polling,
    //    or two different builds), one will overwrite the other. Scalar
    //    counters (totalBuilds, etc.) can stay as FieldValue.increment(),
    //    but dailyBreakdown must be updated within the same transaction.
    // 7. Recompute avgDurationSeconds and successRate within the same transaction
    // 8. Commit
  }

  async getSummary(
    userId: string,
    projectId: string,
  ): Promise<BuildAnalyticsDocument> {
    // Fetch the current month's analytics
  }

  async getTrends(
    userId: string,
    projectId: string,
  ): Promise<Array<{ year: number; month: number; total: number; successRate: number }>> {
    // Fetch the last 3 months, return the trends
  }

  async getBreakdown(
    userId: string,
    projectId: string,
  ): Promise<{ platform: Record<string, any>; environment: Record<string, any> }> {
    // Fetch the current month's breakdown by platform and environment
  }

  private getCurrentYearMonth(): { year: number; month: number } {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }

  private buildAnalyticsDocId(userId: string, projectId: string, year: number, month: number): string {
    return `${userId}#${projectId}#${year}#${month}`;
  }
}
```

**Checklist**:
- [ ] File created
- [ ] `recordBuild()` uses `firestore.db.runTransaction()` for the `dailyBreakdown` update (no read-modify-write outside a transaction)
- [ ] getSummary returns the current month
- [ ] getTrends returns the last 3 months
- [ ] getBreakdown computes percentages by platform/env
- [ ] Specific test: two concurrent `recordBuild()` calls the same day → both increments correctly reflected in `dailyBreakdown` (no lost update)
- [ ] Unit tests

---

### Task 2.2: Create AnalyticsController

**File**: `apps/api/src/analytics/analytics.controller.ts`

```typescript
import { Controller, Get, Param, UseGuards, Req } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { AnalyticsService } from './analytics.service';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@UseGuards(JwtAuthGuard)
@Controller('projects')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get(':id/analytics/summary')
  async getSummary(@Req() req: AuthenticatedRequest, @Param('id') projectId: string) {
    // Call analyticsService.getSummary(req.user.id, projectId)
    // Return AnalyticsSummaryResponse
  }

  @Get(':id/analytics/trends')
  async getTrends(@Req() req: AuthenticatedRequest, @Param('id') projectId: string) {
    // Call analyticsService.getTrends(req.user.id, projectId)
    // Return AnalyticsTrendsResponse
  }

  @Get(':id/analytics/breakdown')
  async getBreakdown(@Req() req: AuthenticatedRequest, @Param('id') projectId: string) {
    // Call analyticsService.getBreakdown(req.user.id, projectId)
    // Return AnalyticsBreakdownResponse
  }
}
```

**Checklist**:
- [ ] File created
- [ ] 3 endpoints created
- [ ] Auth guard applied
- [ ] Project ownership verified (must be explicitly duplicated in `AnalyticsService`, this is NOT shared anywhere else in the code — see the `getOwnedProject` pattern in `BuildsService`)

---

### Task 2.3: Create AnalyticsModule

**File**: `apps/api/src/analytics/analytics.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { FirestoreModule } from '../firestore/firestore.module';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  imports: [FirestoreModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
```

**Checklist**:
- [ ] File created
- [ ] Service and controller declared
- [ ] Service exported (for other modules)

---

### Task 2.4: Integrate into BuildsService

**File**: `apps/api/src/builds/builds.service.ts`

**Change**: inside `finalizeBuildStatus()` (created in Step 0, Task 0.1) — **not** directly inside `refreshStatus()`, so the call fires whether finalization comes from polling or the webhook:

```typescript
// Inside finalizeBuildStatus(), right after computing isFinished:
if (isFinished && !data.finishedAt) {
  update.finishedAt = FieldValue.serverTimestamp();
  // ... durationSeconds ...

  // ADD:
  await this.analyticsService.recordBuild(userId, projectId, {
    platform: data.platform,
    environment: data.environment,
    status,
    durationSeconds: update.durationSeconds ?? null,
  });
}
```

**Checklist**:
- [ ] Import AnalyticsService in the BuildsService constructor
- [ ] Call added inside `finalizeBuildStatus()` (not inside `refreshStatus()`)
- [ ] Only called when the build is finished (success/failed/cancelled), `!data.finishedAt` guard already in place

---

## 🔔 STEP 3: Notifications Service

### Task 3.1: Create NotificationConfigService

**File**: `apps/api/src/notifications/notification-config.service.ts`

```typescript
@Injectable()
export class NotificationConfigService {
  constructor(private readonly firestore: FirestoreService) {}

  async upsert(
    userId: string,
    projectId: string,
    dto: UpsertNotificationConfigDto,
  ): Promise<NotificationConfigResponse> {
    // CRUD: upsert the notification config
    // 1. Verify the user owns the project
    // 2. Fetch the existing doc or create a new one
    // 3. Merge the data (dto)
    // 4. Save
    // 5. Return in Response format
  }

  async getConfig(
    userId: string,
    projectId: string,
  ): Promise<NotificationConfigResponse> {
    // Fetch the config or return an empty default
  }
}
```

**Checklist**:
- [ ] File created
- [ ] Full CRUD
- [ ] Project ownership verification (explicitly duplicated, same as for Analytics)

---

### Task 3.2: Create NotificationsService (with BullMQ + SMTP)

**File**: `apps/api/src/notifications/notifications.service.ts`

**Email — decision**: no third-party provider (SendGrid/Resend/Mailgun). Sent via **SMTP** using `nodemailer`, from an address on the same domain as the server. Hosting for this SMTP account (Infomaniak VPS or Firebase Function) is **not decided yet** — to be revisited separately. In the meantime, the code should read the SMTP config from env variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`) without assuming a specific provider: any standard SMTP server should work as-is.

```typescript
import * as nodemailer from 'nodemailer';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private mailer: nodemailer.Transporter;

  constructor(
    private readonly firestore: FirestoreService,
    @InjectQueue('notifications') private readonly notificationQueue: Queue,
    private readonly configService: NotificationConfigService,
    private readonly config: ConfigService,
  ) {
    this.mailer = nodemailer.createTransport({
      host: this.config.getOrThrow<string>('SMTP_HOST'),
      port: this.config.get<number>('SMTP_PORT', 587),
      secure: this.config.get<number>('SMTP_PORT', 587) === 465,
      auth: {
        user: this.config.getOrThrow<string>('SMTP_USER'),
        pass: this.config.getOrThrow<string>('SMTP_PASSWORD'),
      },
    });
  }

  onModuleInit() {
    // Register the job handlers
    this.notificationQueue.process('slack-notification', this.handleSlackNotification.bind(this));
    this.notificationQueue.process('email-notification', this.handleEmailNotification.bind(this));
  }

  async onBuildStatusChanged(event: BuildStatusChangedEvent) {
    // Fetch the project's notification config
    const config = await this.configService.getConfig(event.userId, event.projectId);

    // If Slack is enabled and the event is in the list
    if (config.slack?.enabled && config.slack.events.includes(`build.${event.status}`)) {
      await this.notificationQueue.add('slack-notification', {
        projectId: event.projectId,
        config: config.slack,
        event,
      });
    }

    // If email is enabled
    if (config.email?.enabled && config.email.events.includes(`build.${event.status}`)) {
      await this.notificationQueue.add('email-notification', {
        userId: event.userId,
        event,
      });
    }
  }

  @Process('slack-notification')
  async handleSlackNotification(job: Job) {
    const { config, event } = job.data;
    const message = this.formatSlackMessage(event);

    try {
      await axios.post(config.webhookUrl, message, { timeout: 5000 });
    } catch (error) {
      // BullMQ retries automatically
      throw error;
    }
  }

  @Process('email-notification')
  async handleEmailNotification(job: Job) {
    const { userId, event } = job.data;
    const user = await this.firestore.db.collection(USERS_COLLECTION).doc(userId).get();
    const email = (user.data() as UserDocument | undefined)?.email;
    if (!email) return;

    await this.mailer.sendMail({
      from: this.config.getOrThrow<string>('SMTP_FROM'),
      to: email,
      subject: `Build ${event.status} — ${event.platform}`,
      text: this.formatEmailBody(event),
    });
  }

  private formatEmailBody(event: BuildStatusChangedEvent): string {
    return `Build ${event.buildId} (${event.platform}, ${event.environment}) is now "${event.status}".`;
  }

  private formatSlackMessage(event: BuildStatusChangedEvent): Record<string, any> {
    const color = event.status === 'success' ? '#36a64f' : '#d9393d';
    const emoji = event.status === 'success' ? '✅' : '❌';

    return {
      attachments: [
        {
          color,
          title: `${emoji} Build ${event.status}`,
          fields: [
            { title: 'Platform', value: event.platform, short: true },
            { title: 'Environment', value: event.environment, short: true },
            { title: 'Build ID', value: event.buildId, short: true },
            event.durationSeconds && {
              title: 'Duration',
              value: `${Math.round(event.durationSeconds / 60)}m ${event.durationSeconds % 60}s`,
              short: true,
            },
          ].filter(Boolean),
        },
      ],
    };
  }
}
```

**Checklist**:
- [ ] File created
- [ ] Queue fully set up
- [ ] Job handlers registered
- [ ] `nodemailer` added to dependencies (`npm install nodemailer @types/nodemailer`)
- [ ] Env variables `SMTP_HOST/PORT/USER/PASSWORD/FROM` documented in `.env.example`
- [ ] Slack message formatting
- [ ] Error handling + retry
- [ ] **Don't block on SMTP hosting** (Infomaniak VPS vs Firebase Function) — separate decision, the code should work with any SMTP server as long as the env variables are set

---

### Task 3.3: Create NotificationsController

**File**: `apps/api/src/notifications/notifications.controller.ts`

```typescript
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class NotificationsController {
  constructor(
    private readonly notificationConfigService: NotificationConfigService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Get(':id/notifications/config')
  async getConfig(@Req() req: AuthenticatedRequest, @Param('id') projectId: string) {
    return this.notificationConfigService.getConfig(req.user.id, projectId);
  }

  @Post(':id/notifications/config')
  async upsertConfig(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
    @Body() dto: UpsertNotificationConfigDto,
  ) {
    return this.notificationConfigService.upsert(req.user.id, projectId, dto);
  }

  @Post(':id/notifications/test')
  async sendTest(
    @Req() req: AuthenticatedRequest,
    @Param('id') projectId: string,
  ) {
    // Send a test notification to Slack (or email)
    const config = await this.notificationConfigService.getConfig(req.user.id, projectId);

    if (!config.slack?.enabled) {
      throw new BadRequestException('Slack not configured');
    }

    // Send test message
    const testEvent: BuildStatusChangedEvent = {
      buildId: 'test-123',
      projectId,
      userId: req.user.id,
      platform: 'ios',
      environment: 'staging',
      status: 'success',
      durationSeconds: 420,
    };

    await this.notificationsService.onBuildStatusChanged(testEvent);
    return { message: 'Test notification sent' };
  }
}
```

**Checklist**:
- [ ] File created
- [ ] 3 endpoints: GET, POST config, POST test
- [ ] Auth guard

---

### Task 3.4: Create NotificationsModule

**File**: `apps/api/src/notifications/notifications.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FirestoreModule } from '../firestore/firestore.module';
import { NotificationsService } from './notifications.service';
import { NotificationConfigService } from './notification-config.service';
import { NotificationsController } from './notifications.controller';

@Module({
  imports: [
    FirestoreModule,
    BullModule.registerQueue({
      name: 'notifications',
    }),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationConfigService],
  exports: [NotificationsService, NotificationConfigService],
})
export class NotificationsModule {}
```

**Checklist**:
- [ ] File created
- [ ] Queue registered
- [ ] Services and controller declared
- [ ] Confirm Redis is running in the deployment environment (`REDIS_URL`), not just locally

---

### Task 3.5: Integrate into BuildsService

**File**: `apps/api/src/builds/builds.service.ts`

**Change**: inside `finalizeBuildStatus()` (Step 0), right next to the Analytics call (Task 2.4), create a `BuildStatusChangedEvent` and call `NotificationsService`:

```typescript
// Inside finalizeBuildStatus(), after the call to analyticsService.recordBuild():
if (isFinished && !data.finishedAt) {
  const statusChangedEvent = new BuildStatusChangedEvent(
    buildId,
    projectId,
    userId,
    data.platform,
    data.environment,
    status,
    update.durationSeconds ?? null,
    data.status,
  );

  await this.notificationsService.onBuildStatusChanged(statusChangedEvent);
}
```

**Checklist**:
- [ ] Import NotificationsService and BuildStatusChangedEvent
- [ ] Call added inside `finalizeBuildStatus()` (not inside `refreshStatus()`)
- [ ] Event created with all parameters

---

### Task 3.6: Add the modules to App.module

**File**: `apps/api/src/app.module.ts`

```typescript
import { AnalyticsModule } from './analytics/analytics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { GithubWebhookModule } from './github/github-webhook.module'; // or integrated into GithubModule, see Task 0.5

@Module({
  imports: [
    // ... existing ...
    AnalyticsModule,       // ADD
    NotificationsModule,   // ADD
    GithubWebhookModule,   // ADD (Step 0)
  ],
  // ...
})
export class AppModule {}
```

**Checklist**:
- [ ] Imports added
- [ ] Order: after QueueModule (dependency)
- [ ] No circular dependency at startup (see Task 0.5)

---

## 🎨 STEP 4: Frontend - Analytics Page

### Task 4.1: Create AnalyticsSummaryComponent

**File**: `apps/web/src/app/features/projects/analytics/analytics-summary.ts`

```typescript
import { Component, input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { signal, effect } from '@angular/core';
import { ProjectsService } from '../../../core/projects/projects.service';

interface AnalyticsSummary {
  totalBuilds: number;
  totalSuccessful: number;
  totalFailed: number;
  avgDurationSeconds: number;
  successRate: number;
  byPlatform: Record<string, any>;
  byEnvironment: Record<string, any>;
}

@Component({
  selector: 'app-analytics-summary',
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="analytics-summary">
      <div class="stat-card">
        <div class="label">Total Builds</div>
        <div class="value">{{ summary()?.totalBuilds ?? '—' }}</div>
      </div>

      <div class="stat-card">
        <div class="label">Success Rate</div>
        <div class="value" [class.success]="(summary()?.successRate ?? 0) >= 90">
          {{ summary()?.successRate ? (summary()!.successRate.toFixed(1) + '%') : '—' }}
        </div>
      </div>

      <div class="stat-card">
        <div class="label">Avg Duration</div>
        <div class="value">{{ formatDuration(summary()?.avgDurationSeconds) }}</div>
      </div>

      <div class="stat-card">
        <div class="label">Failed</div>
        <div class="value error">{{ summary()?.totalFailed ?? '—' }}</div>
      </div>
    </div>

    <div class="breakdown">
      <div class="breakdown-section">
        <h3>By Platform</h3>
        @for (platform of ['ios', 'android']; track platform) {
          <div class="breakdown-item">
            <span>{{ platform | uppercase }}</span>
            <span>{{ summary()?.byPlatform?.[platform]?.total ?? 0 }} builds</span>
          </div>
        }
      </div>

      <div class="breakdown-section">
        <h3>By Environment</h3>
        @for (env of ['staging', 'production']; track env) {
          <div class="breakdown-item">
            <span>{{ env | titlecase }}</span>
            <span>{{ summary()?.byEnvironment?.[env]?.total ?? 0 }} builds</span>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .analytics-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .stat-card {
      padding: 1.5rem;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
    }

    .label {
      font-size: 0.875rem;
      color: var(--color-text-secondary);
      margin-bottom: 0.5rem;
    }

    .value {
      font-size: 2rem;
      font-weight: bold;
      color: var(--color-text);
    }

    .value.success {
      color: #36a64f;
    }

    .value.error {
      color: #d9393d;
    }

    .breakdown {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2rem;
    }

    .breakdown-section h3 {
      margin-top: 0;
      margin-bottom: 1rem;
      font-size: 1rem;
    }

    .breakdown-item {
      display: flex;
      justify-content: space-between;
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--color-border);
    }
  `,
})
export class AnalyticsSummaryComponent {
  projectId = input.required<string>();
  summary = signal<AnalyticsSummary | null>(null);

  constructor(private projectsService: ProjectsService) {
    effect(() => {
      const id = this.projectId();
      this.projectsService.getAnalyticsSummary(id).subscribe((data) => {
        this.summary.set(data);
      });
    });
  }

  formatDuration(seconds: number | undefined): string {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  }
}
```

**Note**: follows the project's rules — `ChangeDetectionStrategy.OnPush`, native `@for`/`@if` instead of `*ngFor`/`*ngIf`, no explicit `standalone: true` (default in Angular v20+), `effect()` in the constructor rather than `ngOnInit`.

**Checklist**:
- [ ] Component created
- [ ] `ChangeDetectionStrategy.OnPush`
- [ ] Signals for state
- [ ] Native control flow (`@for`, not `*ngFor`)
- [ ] API call on init
- [ ] Duration formatting
- [ ] Basic styling

---

### Task 4.2: Create AnalyticsChartsComponent

**File**: `apps/web/src/app/features/projects/analytics/analytics-charts.ts`

No chart library is currently installed in `apps/web` (verified). Install `chart.js` (lightweight, no Angular wrapper to maintain): `npm install chart.js --workspace apps/web`.

**Checklist**:
- [ ] `chart.js` added to dependencies
- [ ] Trends chart built
- [ ] Last 30 days visible
- [ ] Success rate as a percentage
- [ ] Check the impact on bundle size (lazy-load the chart component with the analytics route)

---

### Task 4.3: Create AnalyticsPage

**File**: `apps/web/src/app/features/projects/analytics/analytics.ts`

Combine the two components above.

**Route**: `/projects/:id/analytics`

**Checklist**:
- [ ] Page created
- [ ] Route added in `project-shell.ts`, lazy-loaded like the existing routes (`builds`, `secrets`)
- [ ] Components imported

---

## 📬 STEP 5: Frontend - Notifications Config

### Task 5.1: Create SlackConfigFormComponent

**File**: `apps/web/src/app/features/projects/notifications/slack-config-form.ts`

```typescript
@Component({
  selector: 'app-slack-config-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()">
      <div class="form-group">
        <label for="webhookUrl">Slack Webhook URL</label>
        <input id="webhookUrl" type="text" formControlName="webhookUrl" placeholder="https://hooks.slack.com/..." />
        <small>Get this from <a href="https://api.slack.com/apps" target="_blank" rel="noopener">Slack API</a></small>
      </div>

      <div class="form-group">
        <label>Notify on events:</label>
        <label class="checkbox">
          <input type="checkbox" formControlName="events" [value]="'build.started'" />
          Build started
        </label>
        <label class="checkbox">
          <input type="checkbox" formControlName="events" [value]="'build.success'" />
          Build succeeded
        </label>
        <label class="checkbox">
          <input type="checkbox" formControlName="events" [value]="'build.failed'" />
          Build failed
        </label>
      </div>

      <div class="actions">
        <button type="button" (click)="onTestMessage()">Test Message</button>
        <button type="submit" [disabled]="form.invalid || loading()">Save</button>
      </div>

      @if (successMessage()) {
        <div class="success">✅ Saved!</div>
      }
      @if (errorMessage()) {
        <div class="error">❌ {{ errorMessage() }}</div>
      }
    </form>
  `,
})
export class SlackConfigFormComponent {
  projectId = input.required<string>();
  form = new FormGroup({
    webhookUrl: new FormControl('', [Validators.required, Validators.pattern(/https:\/\/hooks\.slack\.com\/.+/)]),
    events: new FormArray([]),
    enabled: new FormControl(true),
  });
  loading = signal(false);
  successMessage = signal('');
  errorMessage = signal('');

  constructor(private projectsService: ProjectsService) {
    this.loadConfig();
  }

  loadConfig() {
    this.projectsService.getNotificationConfig(this.projectId()).subscribe((config) => {
      if (config.slack) {
        this.form.patchValue(config.slack);
      }
    });
  }

  onTestMessage() {
    this.loading.set(true);
    this.projectsService.testNotification(this.projectId()).subscribe({
      next: () => {
        this.successMessage.set('Test message sent!');
        setTimeout(() => this.successMessage.set(''), 3000);
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMessage.set(err.error.message);
        this.loading.set(false);
      },
    });
  }

  onSubmit() {
    this.loading.set(true);
    this.projectsService.updateNotificationConfig(this.projectId(), { slack: this.form.value }).subscribe({
      next: () => {
        this.successMessage.set('Saved!');
        setTimeout(() => this.successMessage.set(''), 3000);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('Failed to save');
        this.loading.set(false);
      },
    });
  }
}
```

**Checklist**:
- [ ] Component created (Reactive Forms, `ChangeDetectionStrategy.OnPush`)
- [ ] `<label for>` correctly associated with fields (AXE)
- [ ] Form validation
- [ ] API calls (4 methods to add to `ProjectsService`: `getAnalyticsSummary`, `getNotificationConfig`, `testNotification`, `updateNotificationConfig` — don't exist yet)
- [ ] Error/success handling

---

### Task 5.2: Create NotificationsPage

**File**: `apps/web/src/app/features/projects/notifications/notifications-config.ts`

```typescript
@Component({
  selector: 'app-notifications-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>Notification Configuration</h2>

    <div class="config-section">
      <h3>Slack Integration</h3>
      <app-slack-config-form [projectId]="projectId()" />
    </div>
  `,
})
export class NotificationsConfigComponent {
  projectId = input.required<string>();
}
```

**Route**: `/projects/:id/notifications`

**Checklist**:
- [ ] Page created
- [ ] Route added (lazy loading)
- [ ] SlackConfigFormComponent imported

---

## 🔐 STEP 6: Plan Gating + Guards

### Task 6.1: Create PlanGuard (NestJS)

**File**: `apps/api/src/auth/guards/plan.guard.ts`

**⚠️ Missing prerequisite**: there is currently **no `UsersService`** in the code (`apps/api/src/users/` only contains `user.model.ts`). All user logic (Firestore lookups, OAuth creation) lives directly in `AuthService` (`apps/api/src/auth/auth.service.ts`). Two options:
1. Create an actual minimal `UsersModule`/`UsersService` with `findById()`, and migrate the relevant lookups out of `AuthService`.
2. Or have `PlanGuard` read directly from Firestore (`USERS_COLLECTION`) without going through a dedicated service.

Option 1 is preferable long-term (also reusable for Analytics/Notifications ownership) but adds ~0.5d not budgeted in the original plan.

```typescript
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FirestoreService } from '../../firestore/firestore.service';
import { USERS_COLLECTION, type UserDocument, type Plan } from '../../users/user.model';

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private firestore: FirestoreService, // or UsersService if created (Task 6.0)
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPlan = this.reflector.get<Plan>('requiredPlan', context.getHandler());
    if (!requiredPlan) return true; // No restriction

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    if (!userId) {
      throw new ForbiddenException('Unauthorized');
    }

    const doc = await this.firestore.db.collection(USERS_COLLECTION).doc(userId).get();
    const user = doc.data() as UserDocument | undefined;
    const plans: Record<Plan, number> = { free: 0, starter: 1, pro: 2, enterprise: 3 };
    const requiredLevel = plans[requiredPlan] ?? 0;
    const userLevel = plans[user?.plan ?? 'free'] ?? 0;

    if (userLevel < requiredLevel) {
      throw new ForbiddenException(`This feature requires ${requiredPlan} plan or higher`);
    }

    return true;
  }
}
```

**Checklist**:
- [ ] Decision made: `UsersService` created, or direct Firestore access in the guard
- [ ] File created
- [ ] Plan comparison logic
- [ ] Clear error message

---

### Task 6.2: Apply PlanGuard on endpoints

**In** `notifications.controller.ts` and `analytics.controller.ts`:

```typescript
@Post(':id/notifications/config')
@SetMetadata('requiredPlan', 'starter')
@UseGuards(JwtAuthGuard, PlanGuard)
async upsertConfig(...) {
  // ...
}

// For analytics: free for everyone (read-only)
@Get(':id/analytics/summary')
@UseGuards(JwtAuthGuard) // NO PlanGuard
async getSummary(...) {
  // ...
}
```

**Checklist**:
- [ ] Notifications endpoints: `requiredPlan='starter'`
- [ ] Analytics endpoints: no restriction
- [ ] No `teamMembersLimit` quota/gating for "team" — removed from the plan (no collaboration concept in the current model)

---

## ✅ Final tasks

### Task 7.1: Unit tests

```
- [x] BuildsService.finalizeBuildStatus() → idempotency guard covered (already-finished build: no re-write of finishedAt/duration/artifactUrl); success + failure status mapping covered (Step 0 scope)
- [x] GithubWebhookService → invalid signature rejected, valid payload finalizes the build (also: wrong secret, non-"completed" action, no matching project, no matching build)
- [ ] AnalyticsService.recordBuild() → correct increments, including under concurrent calls (dailyBreakdown) — out of scope for Step 0
- [ ] NotificationConfigService.upsert() → stores in Firestore — out of scope for Step 0
- [ ] NotificationsService.formatSlackMessage() → correct format — out of scope for Step 0
- [ ] NotificationsService.handleEmailNotification() → mocked SMTP send — out of scope for Step 0
- [ ] All other services — out of scope for Step 0
```

**Command**: `npm run test:api`

**Checklist**:
- [ ] Coverage > 80%

---

### Task 7.2: E2E tests

```
- [ ] POST /github/webhook (workflow_run.completed payload) → verifies analytics + notifications fire WITHOUT any client call
- [ ] POST /projects/:id/builds → verifies analytics incremented (via polling, existing case)
- [ ] POST /projects/:id/notifications/config → saves and returns
- [ ] POST /projects/:id/notifications/test → sends to Slack (mock)
```

**Checklist**:
- [ ] All happy paths covered
- [ ] The "no client connected" case (webhook only) is explicitly tested — this is the problem Phase 0 solves

---

### Task 7.3: Frontend verification

```
- [ ] Analytics page loads and displays the numbers
- [ ] Notifications config form validates
- [ ] Slack config test button works
```

**Checklist**:
- [ ] No console errors
- [ ] Responsive UI
- [ ] AXE: no accessibility regression on the new pages

---

## 📝 Merges and git

**Branches**:
- `feature/github-webhook` → merge Phase 0 (prerequisite)
- `feature/analytics-service` → merge Analytics Phase
- `feature/notifications-service` → merge Notifications Phase
- `feature/analytics-frontend` → merge Frontend Analytics Phase
- `feature/notifications-frontend` → merge Frontend Notifications Phase
- `feature/plan-gating` → merge Gating Phase

**Atomic commits**:
- Each service = 1 commit
- Each controller = 1 commit
- Tests = 1 commit

**PR**:
- Description: "Phase 0+1: GitHub Webhook + Analytics + Notifications backend"
- Checklist: all tests pass

---

## ⏱️ Timeline

| Task | Est. | Cumulative |
|------|------|--------|
| 0.1-0.5 GitHub Webhook (prerequisite) | 1-2d | 1-2d |
| 1.1-1.3 Models | 1h | 1.25-2.25d |
| 2.1-2.4 Analytics | 2d | 3.25-4.25d |
| 3.1-3.6 Notifications | 2d | 5.25-6.25d |
| 4.1-4.3 Frontend Analytics | 1d | 6.25-7.25d |
| 5.1-5.2 Frontend Notifications | 1d | 7.25-8.25d |
| 6.1-6.2 Plan Gating (+ create UsersService) | 1d | 8.25-9.25d |
| 7.1-7.3 Tests + Verification | 1d | **9.25-10.25d** |

**Realistic total**: 2-3 weeks for Phase 0+1 complete (webhook + analytics + notifications + frontend + tests). SMTP hosting (Infomaniak VPS vs Firebase Function) is a separate infra decision, to be settled before Task 3.2 goes to production but does not block development.
