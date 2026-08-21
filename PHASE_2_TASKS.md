# Phase 2: Auto-trigger on Push + GitHub Actions Quota + SMTP Hosting Decision

## 📌 Overview

**Scope decision (2026-08-21)**: of the remaining MVP gaps identified against `specs/001-mobileflow-mvp/prd.md` §8 (Definition of Done) and §2.3 (Non-Goals), only three are in scope for this phase:

- **FR-6** — auto-trigger a build on push to a configured branch (`prd.md` US3, marked **[DÉCIDÉ]**)
- **FR-7** — show the user's remaining GitHub Actions quota before a build that might exceed it (`prd.md` §8, **DoD item #11**)
- **SMTP hosting decision** — where the transactional-email SMTP account is hosted (Infomaniak VPS vs Firebase Function), referenced as an open decision in `notifications.service.ts:121` and `PHASE_1_TASKS.md` Task 3.2

**Explicitly out of scope for this phase** (do not implement):
- **FR-9** (certificate expiration check) — user decision, deferred
- **FR-10** (build history filters by status/platform/branch) — user decision, deferred

**Estimated duration**: 3-4 days
**Dependencies**: None blocking — GitHub webhook infrastructure (signature verification, `GithubWebhookController`/`Service`) already exists and is merged on `main` (`apps/api/src/github/github-webhook.*`, delivered in `PHASE_1_TASKS.md` Step 0). This phase extends it, does not recreate it.

**Order**:
0. SMTP hosting decision (pure decision + provisioning, unblocks Phase 1's already-written email code — do this first, it's the fastest win)
1. Auto-trigger on push (FR-6)
2. GitHub Actions quota warning (FR-7)

> ⚠️ **Read before starting Step 1**: the literal wording of `spec.md` FR-6 ("le workflow poussé contient un trigger `on: push` scopé") describes a **different architecture** than what actually exists today. If the generated GitHub Actions workflow (`apps/api/src/github/workflow-template.ts`) gets its own native `on: push` trigger, GitHub will run it **without MobileFlow's API ever creating a `Build` Firestore document first** — which breaks the existing secrets-injection pipeline (`/internal/secrets`, short-lived run token minted by `BuildsService.create()`) and build history. Step 1 below implements FR-6 through the **existing webhook** instead (GitHub → MobileFlow `POST /github/webhook` on a `push` event → MobileFlow calls `BuildsService.create()` itself, exactly like a manual trigger would). This preserves every invariant the Build Engine already relies on. Do not add a `push:` block to `workflow-template.ts`.

---

## 🔧 STEP 0: SMTP hosting decision

Not a code task. `NotificationsService` (`apps/api/src/notifications/notifications.service.ts`) already reads `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM` from env and degrades to a no-op with a warning log if they're missing — the code works with any standard SMTP server already, nothing to change there.

### Task 0.1: Decide hosting
- Options: existing Infomaniak VPS (already provisioned per code comment) vs a Firebase Function/Extension.
- Constraint: EU data residency already acted in `prd.md` §3.4 — factor this into the choice.

**Decision (2026-08-21)**: Infomaniak VPS. It's EU-hosted (satisfies §3.4 without extra work), it's where the API itself already runs (no new cross-cloud dependency), and a Firebase Function/Extension would still need to relay through an external SMTP/API provider — it doesn't remove the dependency, just adds an abstraction layer `NotificationsService` doesn't need (it already reads plain SMTP env vars).

**Checklist**:
- [x] Decision made and written down (comment in `notifications.service.ts:121-124` updated; `.env.example` updated to match)

### Task 0.2: Provision and configure
- [x] Sending mailbox/account created on the chosen host and credentials set in `apps/api/.env` (dev) — done manually by the user
- [ ] Production environment config still to be set at deploy time
- [ ] Send one real test email through the existing flow (`POST /projects/:id/notifications/test` with `email.enabled: true`, or trigger a real build to completion) and confirm delivery/inbox placement (check SPF/DKIM if the sending domain is new) — not yet confirmed

---

## 🔔 STEP 1: Auto-trigger on push (FR-6)

### Task 1.1: Add `autoTriggerBranch` to `Project`

**File**: `apps/api/src/projects/project.model.ts`

```typescript
export interface ProjectDocument {
  userId: string;
  name: string;
  githubRepoFullName: string;
  framework: Framework;
  autoTriggerBranch: string | null; // ADD — branch that triggers an automatic build on push; null = disabled
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}
```

Update `ProjectsService.create()` to default new projects to `autoTriggerBranch: null` (auto-trigger is opt-in).

**Checklist**:
- [x] Field added to `ProjectDocument`
- [x] `ProjectsService.create()` sets `autoTriggerBranch: null` by default
- [x] No dedicated `toApiProject()` mapper exists — `findAllForUser`/`findOneOwned` spread the raw Firestore doc, so the field is already included in every API response as-is

---

### Task 1.2: Extend `UpdateProjectDto`

**File**: `apps/api/src/projects/dto/update-project.dto.ts`

Current file only has `name`. `ProjectsController.update()` → `ProjectsService.update()` already spreads the whole DTO into the Firestore update (`projects.service.ts:89-96`), so no service-layer change is needed beyond the DTO itself:

```typescript
import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateProjectDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  autoTriggerBranch?: string | null; // omit/undefined = leave unchanged, null = disable, string = branch name
}
```

**Checklist**:
- [x] `autoTriggerBranch` added as optional field
- [x] Verified: `ValidationPipe({ whitelist: true, transform: true })` (main.ts) keeps `autoTriggerBranch` since it's decorated (`@IsOptional`), and `@IsOptional` short-circuits validation for both `null` and `undefined` — `null` reaches `ProjectsService.update()`'s spread untouched

---

### Task 1.3: Handle the `push` event in the webhook controller

**File**: `apps/api/src/github/github-webhook.controller.ts`

Current code only processes `x-github-event: workflow_run` and returns `{ ignored: true }` for everything else:

```typescript
@Post('webhook')
async handleWebhook(
  @Req() req: RawBodyRequest<Request>,
  @Headers('x-hub-signature-256') signature: string | undefined,
  @Headers('x-github-event') event: string | undefined,
) {
  if (!signature || !req.rawBody) {
    throw new BadRequestException('Signature manquante.');
  }
  this.webhookService.verifySignature(req.rawBody, signature);

  if (event === 'workflow_run') {
    await this.webhookService.handleWorkflowRunEvent(req.body as WorkflowRunWebhookPayload);
    return { ok: true };
  }
  if (event === 'push') {
    await this.webhookService.handlePushEvent(req.body as PushWebhookPayload);
    return { ok: true };
  }
  return { ignored: true };
}
```

**Checklist**:
- [x] `push` branch added alongside `workflow_run`, signature verification unchanged (already event-agnostic)
- [x] Still returns `{ ignored: true }` for any other event type

---

### Task 1.4: `GithubWebhookService.handlePushEvent`

**File**: `apps/api/src/github/github-webhook.service.ts`

GitHub's `push` webhook payload carries `ref` as `refs/heads/<branch>` and `repository.full_name`. Also skip branch **deletions** (`deleted: true`) — GitHub sends a push event for those too, with no commits to build.

```typescript
export interface PushWebhookPayload {
  ref: string; // "refs/heads/main"
  deleted: boolean;
  repository: { full_name: string };
}

async handlePushEvent(payload: PushWebhookPayload): Promise<void> {
  if (payload.deleted) {
    return; // branch deletion, nothing to build
  }
  const branch = payload.ref.replace(/^refs\/heads\//, '');
  const repoFullName = payload.repository.full_name;

  const projectSnap = await this.firestore.db
    .collection(PROJECTS_COLLECTION)
    .where('githubRepoFullName', '==', repoFullName)
    .where('autoTriggerBranch', '==', branch)
    .get();
  if (projectSnap.empty) {
    return; // no project has auto-trigger enabled for this repo+branch
  }

  await Promise.all(
    projectSnap.docs.map(async (doc) => {
      const project = doc.data() as ProjectDocument;
      const plan = await this.resolvePlan(project.userId); // see note below
      // Reuse the exact same path a manual "Start build" click goes through —
      // do NOT call GithubService/workflow_dispatch directly here.
      await this.buildsService.create(project.userId, doc.id, plan, {
        environment: Environment.staging, // never auto-trigger production, see decision below
        branch,
        platforms: [Platform.android, Platform.ios], // see decision below
      });
    }),
  );
}
```

**Design decisions made for you (flag to the user only if you disagree, otherwise proceed)**:
- **Environment is always `staging`.** Production builds are gated behind a paid plan (`BuildsService.create()` already throws `ForbiddenException` for free-plan production, `builds.service.ts:60-64`) and non-goals explicitly keep app-store publishing out of MVP — an unattended push should never trigger a production/store-bound build.
- **Both platforms (`android`, `ios`) are triggered on every matching push.** There is no per-project persisted platform preference today (removed along with `BuildConfig` in the Phase 3 refactor, see `specs/001-mobileflow-mvp/tasks.md` T3.7-T3.12). Adding one is out of scope for this phase — if only one platform has secrets configured, the other platform's build will simply fail at its own step (iOS: missing cert/profile in `/internal/secrets`; Android: `assembleDebug` doesn't need secrets so it always attempts a build). This is acceptable for MVP; revisit if it proves noisy.
- **`resolvePlan(userId)` needs a Firestore read on `USERS_COLLECTION`** (there's no `UsersService` in this codebase — see the same note in `PHASE_1_TASKS.md` Task 6.1, `PlanGuard` resolved this by reading `request.user.plan` off the JWT, which isn't available here since this is a webhook, not an authenticated request). Read `UserDocument.plan` directly via `this.firestore.db.collection(USERS_COLLECTION).doc(project.userId).get()`, default to `Plan.free` if missing — mirrors the pattern already used in `handleWorkflowRunEvent` conceptually (direct Firestore reads, no service indirection) and in `PlanGuard`.

**Checklist**:
- [x] `PushWebhookPayload` type added
- [x] Branch deletions ignored
- [x] Firestore query matches on `githubRepoFullName` AND `autoTriggerBranch` — no composite index needed, two-equality-filter queries are auto-indexed by Firestore's single-field indexes (only inequality/orderBy combos need an explicit composite index); confirm against real Firestore during Task 1.9's manual test
- [x] Multiple projects for the same push handled — via `Promise.allSettled` (stronger than the suggested `Promise.all`, see next bullet)
- [x] Reuses `BuildsService.create()` (not a parallel/duplicated dispatch path) — same secrets-token issuance, same workflow install-if-missing, same history entry as a manual build
- [x] A `ForbiddenException` from `BuildsService.create()` doesn't crash the webhook handler for other matched projects — implemented with `Promise.allSettled` + `logger.warn` on each rejection

---

### Task 1.5: Avoid stacking builds on rapid successive pushes

Spec.md FR-6 asks for "annulation des runs redondants sur pushs rapprochés". The generated workflow (`workflow-template.ts`) has no `concurrency:` block today (only `workflow_dispatch`, no `push:` trigger — see the architecture note at the top of this document, we deliberately did not add one).

Implement this at the MobileFlow layer instead, in `handlePushEvent` (Task 1.4), before calling `BuildsService.create()`: if a `Build` for the same `projectId` + `branch` is already `queued` or `running`, mark it as superseded before creating the new one, rather than letting both run to completion.

```typescript
// Inside the per-project loop in handlePushEvent, before buildsService.create():
const staleSnap = await this.firestore.db
  .collection(BUILDS_COLLECTION)
  .where('projectId', '==', doc.id)
  .where('branch', '==', branch)
  .where('status', 'in', [BuildStatus.queued, BuildStatus.running])
  .get();
await Promise.all(
  staleSnap.docs.map((staleDoc) =>
    staleDoc.ref.update({ status: BuildStatus.cancelled, finishedAt: FieldValue.serverTimestamp() }),
  ),
);
```

**Checklist**:
- [x] Stale `queued`/`running` builds on the same project+branch are marked `cancelled` before the new one is created (`GithubWebhookService.cancelStaleBuilds`)
- [x] This does **not** attempt to cancel the underlying GitHub Actions run itself (out of scope — the GitHub run for the superseded build keeps executing on GitHub's side, it's just no longer tracked/surfaced as the "current" build in MobileFlow's history). Documented in the method's code comment.
- [x] Unit test added (`github-webhook.service.spec.ts`): asserts the stale build's `ref.update({ status: cancelled, ... })` is invoked, and via `invocationCallOrder` that it happens strictly before `BuildsService.create()`

---

### Task 1.6: Frontend — configure the auto-trigger branch

**File**: `apps/web/src/app/features/projects/*` — add to the existing project detail screen (`/projects/:id`), near the "Workflow de build" section added in Phase 5 (`tasks.md` T5.19), not a new route.

- Reactive form, single text input (branch name), empty = disabled
- Save via `ProjectsService.update(projectId, { autoTriggerBranch: value || null })` — `ProjectsService`/`update()` likely doesn't exist yet client-side for this field, check `apps/web/src/app/core/projects/projects.service.ts` and add if missing (a `PATCH` call already exists for `name`-only updates if any — otherwise add one)
- Follow existing conventions: `OnPush`, reactive forms, `role="alert"` for errors, matching the visual style of the adjacent "Workflow de build" section

**Checklist**:
- [x] `Project` model (`apps/web/src/app/core/projects/project.models.ts`) includes `autoTriggerBranch: string | null`
- [x] `ProjectsService.update()` already existed generically (`PATCH /projects/:id`) and now carries `autoTriggerBranch` via the extended `UpdateProjectPayload` type — no new method needed
- [x] UI section added to `/projects/:id` (`project-detail.ts`, "Auto-trigger on push"), save/clear both work (empty string → `null`)
- [x] AXE: `for="auto-trigger-branch"`/`id="auto-trigger-branch"` matched, error state uses `role="alert"`

---

### Task 1.7: GitHub App webhook event subscription (infra step, not code)

The GitHub App (`mobileflow-pkgr`) currently has the `workflow_run` webhook event enabled (done manually per `PHASE_1_TASKS.md` Task 0.4). It also needs the **`Push`** event enabled for this feature to receive anything.

**Checklist**:
- [x] `Push` event enabled in the GitHub App settings (same place `workflow_run` was enabled) — done manually by the user
- [x] Confirmed: `GITHUB_WEBHOOK_SECRET` covers `push` too, signature validation succeeds on a real `push` payload — confirmed by the user (webhook fired end-to-end)

---

### Task 1.8: Tests

- [x] `GithubWebhookService.handlePushEvent` unit tests added (`github-webhook.service.spec.ts`, `describe('handlePushEvent', ...)`): matches project by repo+branch, ignores when no project matches (no `autoTriggerBranch`), ignores branch deletions, cancels stale builds first (ordering asserted), calls `BuildsService.create()` with `environment: staging` + both platforms, defaults plan to `free` when the user doc is missing, one project's `ForbiddenException` doesn't block the other
- [x] `GithubWebhookController` unit test extended (push forwarding + non-workflow_run/push events ignored) and e2e spec extended (`github-webhook.e2e-spec.ts`): valid `push` payload for a project with `autoTriggerBranch` set → `{ ok: true }`; no matching project → `{ ok: true }` (webhook-level no-op, not the controller's `{ ignored: true }`, which is reserved for event types other than `workflow_run`/`push`)

---

### Task 1.9: Verification

- [x] `npm run build`/lint/test green for `apps/api` (96 unit + 19 e2e tests) and `apps/web` (`ng build` succeeds)
- [x] Manual test confirmed by the user: webhook fired end-to-end on a real push (2026-08-21)

---

## 🎯 STEP 2: GitHub Actions quota warning (FR-7)

### Task 2.1: Spike — verify the billing endpoint is actually reachable

**Read first**: `specs/001-mobileflow-mvp/tasks.md` line 60 already flagged this risk in Phase 2 ("les endpoints de billing/quota Actions de GitHub ne sont généralement pas accessibles via un token d'installation GitHub App pour un compte personnel"). The current `GithubService.getActionsQuota()` (`apps/api/src/github/github.service.ts:473`) calls `GET /repos/{owner}/{repo}/actions/cache/usage` — this returns **Actions cache storage usage in bytes**, not remaining build minutes. It does not answer what DoD #11 asks for, regardless of whether it currently returns `{ available: true, ... }` or not.

Before writing any UI code:

```typescript
// Throwaway script or a temporary route — test against the real installation (mobileflow-pkgr):
const octokit = await this.getInstallationOctokit(userId);
try {
  const { data } = await octokit.request('GET /users/{username}/settings/billing/actions', { username });
  console.log(data); // { total_minutes_used, total_paid_minutes_used, included_minutes, minutes_used_breakdown }
} catch (e) {
  console.log(e.status, e.message); // expect 403/404/410 if the installation token lacks billing access
}
```

**Checklist**:
- [x] Result of the spike documented: **not reachable**. No live GitHub App installation/credentials were available in this environment to run the throwaway request above, so the finding is based on GitHub's documented API behavior rather than an observed HTTP status: the Actions billing endpoints (`GET /users/{username}/settings/billing/actions`, `GET /orgs/{org}/settings/billing/actions`) require a user-to-server OAuth token or a PAT with billing access — GitHub App installation tokens (server-to-server, what `getInstallationOctokit()` produces) are not accepted for these endpoints regardless of account type. This matches the risk already flagged in `tasks.md` Phase 2 and the pre-existing code comment on `getActionsQuota()`. Proceeding with Task 2.2b (not 2.2a). If this assumption turns out wrong against a real installation, re-run the spike script and switch to 2.2a.

---

### Task 2.2a — If the billing endpoint IS reachable

**File**: `apps/api/src/github/github.service.ts`

Replace the `actions/cache/usage` call in `getActionsQuota()`:

```typescript
async getActionsQuota(userId: string, repoFullName: string) {
  const { owner } = this.splitRepo(repoFullName);
  const octokit = await this.getInstallationOctokit(userId);
  try {
    const { data } = await octokit.request('GET /users/{username}/settings/billing/actions', {
      username: owner,
    });
    return {
      available: true as const,
      includedMinutes: data.included_minutes,
      totalMinutesUsed: data.total_minutes_used,
      totalPaidMinutesUsed: data.total_paid_minutes_used,
    };
  } catch {
    return { available: false as const };
  }
}
```

Note: `owner` here should be the **account** the billing applies to, not necessarily the repo owner if the installation spans an org differently than expected — verify against the spike's actual response shape (org accounts use `GET /orgs/{org}/settings/billing/actions` instead, same response shape).

**Checklist** (not applicable — Task 2.1 concluded not reachable, 2.2b taken instead):
- [ ] N/A
- [ ] N/A
- [ ] N/A
- [ ] N/A

### Task 2.2b — If the billing endpoint is NOT reachable

Do not attempt further workarounds in this phase (e.g. requesting a user OAuth token with a billing scope, or an org billing-manager role — both are bigger architectural changes than this phase's scope). Leave `getActionsQuota()` as-is (or explicitly hardcode `{ available: false }` if you'd rather not call a misleading endpoint at all — recommended, since `actions/cache/usage` returning `available: true` with irrelevant data is worse than an honest `false`).

**Checklist**:
- [x] Call removed; `getActionsQuota()` now hardcodes `{ available: false }` (`apps/api/src/github/github.service.ts`) — no misleading `actions/cache/usage` data returned
- [x] Skip to Task 2.4 (frontend degrades to the "quota unavailable" banner directly, Task 2.3 does not apply)

---

### Task 2.3: Frontend — display the quota (only if Task 2.2a was taken)

**File**: `apps/web/src/app/features/projects/build-new/project-build-new.ts`

In `ngOnInit()`, alongside the existing `Promise` that loads branches, also load the quota:

```typescript
protected readonly quota = signal<{ available: boolean; includedMinutes?: number; totalMinutesUsed?: number } | null>(null);

async ngOnInit(): Promise<void> {
  // ... existing project/branches loading ...
  this.quota.set(await this.githubService.getActionsQuota(project.githubRepoFullName));
}
```

Template addition, near the existing free-plan/production warning (`project-build-new.ts:61-69`, same visual pattern — `role="alert"`, amber styling):

```html
@if (quota(); as q) {
  @if (q.available && q.totalMinutesUsed !== undefined && q.includedMinutes !== undefined) {
    @if (q.totalMinutesUsed >= q.includedMinutes) {
      <p class="mt-1 text-sm text-amber-700" role="alert">
        You've used your included GitHub Actions minutes this billing period ({{ q.totalMinutesUsed }} / {{ q.includedMinutes }}).
        This build may use paid minutes on your GitHub account.
      </p>
    } @else {
      <p class="text-sm text-neutral-500">
        GitHub Actions usage: {{ q.totalMinutesUsed }} / {{ q.includedMinutes }} minutes this period.
      </p>
    }
  } @else if (!q.available) {
    <p class="text-sm text-neutral-500">GitHub Actions quota unavailable for this account.</p>
  }
}
```

This is a **warning**, not a hard block — do not disable the submit button on quota exhaustion (GitHub accounts can have paid minutes beyond the included allowance, so "quota exceeded" doesn't necessarily mean the build will fail, unlike the free-plan/production case which is a hard MobileFlow-side rule).

**Checklist** (not applicable — 2.2b taken, see Task 2.4 instead):
- [ ] N/A
- [ ] N/A
- [ ] N/A
- [ ] N/A

---

### Task 2.4: Frontend — graceful degradation (only if Task 2.2b was taken)

Same file, simpler version — just the "unavailable" branch from Task 2.3's template, no minutes math:

```html
@if (quota() && !quota()!.available) {
  <p class="text-sm text-neutral-500">GitHub Actions quota unavailable for this account.</p>
}
```

**Checklist**:
- [x] Loaded in try/catch (`loadQuota()`), degrades to `{ available: false }` on any failure, loaded in parallel with branches via `Promise.all` in `ngOnInit()`
- [x] **Revised after user feedback (2026-08-22)**: an "unavailable" message was initially shown, but the user found a permanent, always-on "unavailable" notice more noise than signal (it's not actionable, and it will always be there under the current `available: false` decision). Changed to show **nothing** when unavailable, and to display the real minutes (`totalMinutesUsed`/`includedMinutes`) if `available` is ever `true` in the future (e.g. if Option A/B from the follow-up discussion gets implemented later). `GithubActionsQuota` (frontend model) already carries the optional `includedMinutes`/`totalMinutesUsed` fields so no further frontend change is needed if the backend starts returning them.
- [x] DoD #11 is only partially satisfied today: no quota UI is visible at all under the current `available: false` decision — this is the user's explicit preference over showing a permanent "unavailable" banner. Not a bug.

---

### Task 2.5: Tests

- [x] `GithubService.getActionsQuota` unit test added (`github.service.spec.ts`): asserts `{ available: false }` with no API call
- [ ] `project-build-new.ts` component test: **not added** — this component/route has no existing `.spec.ts` test file or testing convention to extend (checked: no component-level Angular tests exist anywhere under `apps/web/src/app/features/projects/`); introducing a first-of-its-kind test harness for this one component was judged out of scope for this phase. Manually verifiable instead per Task 2.6.

---

### Task 2.6: Verification

- [x] `npm run build`/lint/test green for `apps/api` and `apps/web` (`ng build` succeeds)
- [x] Manual check confirmed by the user (2026-08-22): initially the "unavailable" banner wasn't visible due to a stale `ng serve` browser bundle (fixed by a page refresh, no code issue) — then, per user feedback, the banner was removed entirely in favor of showing nothing when unavailable (see Task 2.4 above)

---

## 📝 Merges and git

**Suggested branches** (mirrors the `feature/*` convention used for Phase 1, all of which were merged individually):
- `feature/smtp-hosting` → Step 0 (env/config only, may not need a PR if it's pure infra)
- `feature/auto-trigger-push` → Step 1 (FR-6)
- `feature/actions-quota` → Step 2 (FR-7)

**Atomic commits**: one commit per task where practical (model change, webhook handler, frontend section, tests), consistent with the granularity already used in `specs/001-mobileflow-mvp/tasks.md`'s Phase 5 history.

---

## ⏱️ Timeline

| Task | Est. |
|---|---|
| Step 0 — SMTP decision + provisioning | 0.5d |
| Step 1 — Auto-trigger on push (FR-6) | 1.5-2d |
| Step 2 — Actions quota (FR-7, spike-dependent) | 1-1.5d |

**Realistic total**: 3-4 days. Step 2's exact scope depends entirely on the Task 2.1 spike result — budget the low end if the billing endpoint is reachable, the high end (frontend degrades to a static banner) if not.
