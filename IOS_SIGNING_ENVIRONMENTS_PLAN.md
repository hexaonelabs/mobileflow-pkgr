# Plan: environment-aware iOS signing (Ad Hoc vs App Store)

**Status**: draft, not implemented. Written for feasibility review by another agent before any code is touched.

## Goal

Today MobileFlow can only ever export iOS builds Ad Hoc, regardless of the build's `environment`. This is the blocker called out in `FREEMIUM_PLAN.md`'s Phase 2 scope note ("iOS signs Ad Hoc 'always' today... there's no separate App Store distribution certificate yet") and is a hard prerequisite for the Phase 3 TestFlight/webhooks feature (can't auto-deliver to TestFlight a build that isn't even App-Store-exported). This plan makes iOS production builds actually export with an App Store provisioning profile, while staging keeps exporting Ad Hoc — without a bigger rework of how secrets are stored.

## Current state (grounded in code, not assumption)

- `SecretDocument` (`apps/api/src/secrets/secret.model.ts`) stores **one secret per `type` per project** — `ios_certificate`, `ios_provisioning_profile`, `android_keystore`. No `environment` field exists anywhere in this model.
- `SecretsService.create()` (`apps/api/src/secrets/secrets.service.ts:52-57`) deletes any existing secret of the same `type` before storing a new one — "one active secret per type per project, a new upload replaces the previous one."
- `SecretsService.getDecryptedForPlatform(userId, projectId, platform)` (same file, ~line 106) has no `environment` parameter — it can't distinguish anything even if the model had the field.
- `RunTokenDocument` (`apps/api/src/internal/run-token.model.ts`) carries `buildId, projectId, userId, platform` — no `environment`, even though `BuildsService.create()` (`apps/api/src/builds/builds.service.ts:58-136`) already knows `dto.environment` at the moment it calls `RunTokensService.issueToken()`.
- `InternalSecretsController.getSecrets()` (`apps/api/src/internal/internal-secrets.controller.ts`) resolves the token and calls `getDecryptedForPlatform(userId, projectId, platform)` — environment never enters the picture.
- `workflow-template.ts`'s iOS job (`apps/api/src/github/workflow-template.ts`, "Export IPA (Ad Hoc)" step, ~line 158) hardcodes `<key>method</key><string>ad-hoc</string>` in the generated `exportOptions.plist`, unconditionally.
- Android is **not** affected by this problem: staging is an unsigned `assembleDebug` (no secrets requested at all — see `BuildsService.createSingle`'s `needsSigningSecrets` check), production signs with the single stored `android_keystore`. There's no ambiguity to resolve there.

## Core design decision (please verify — this is the part most worth a feasibility check)

Apple's constraint (as I understand it, **needs verification against a real Apple Developer account / current App Store Connect rules**): an **Apple Distribution certificate** can sign both an Ad Hoc export and an App Store export — the certificate itself doesn't need to differ. What *must* differ is the **provisioning profile**: an Ad Hoc profile lists specific device UDIDs, an App Store profile does not, and `xcodebuild -exportArchive`'s `method` key (`ad-hoc` vs `app-store`) must match the profile's actual type or the export fails.

If that holds, the fix only needs to add an environment dimension to `ios_provisioning_profile`, not to `ios_certificate`. This keeps the user's setup burden to "upload one extra provisioning profile" instead of "re-generate and upload a second certificate too." **If a reviewing agent finds this assumption wrong** (e.g. some Apple account configurations do require a distinct certificate per distribution channel), the plan below still holds structurally — `environment` would just need to also apply to `ios_certificate`, which is a mechanical extension of the same design, not a different one.

## Scope

**In scope**: `ios_provisioning_profile` becomes environment-scoped (`staging` → Ad Hoc profile, `production` → App Store profile). `environment` threaded end-to-end from build creation to the workflow's export step.

**Out of scope** (explicitly not doing here):
- Actual TestFlight/App Store Connect upload automation (separate Phase 3 work, this plan only unblocks it).
- Any change to `ios_certificate` or `android_keystore` handling.
- Any change to how secrets are encrypted/stored at rest (`EncryptionService`) — only which document is selected.
- Team/role-based secret access — out of scope per existing project constraints.

## 1. Data model

- `apps/api/src/secrets/secret.model.ts`: add `environment: Environment | null` to `SecretDocument` (import `Environment` from `../builds/build.model`, already a cross-module import elsewhere — e.g. `analytics.service.ts`, `notifications.controller.ts`). `null` for `ios_certificate`/`android_keystore` (unchanged, single slot). Required (`staging`/`production`) for `ios_provisioning_profile`.
- `apps/api/src/internal/run-token.model.ts`: add `environment: Environment` to `RunTokenDocument` (always known at issue time, never optional).

## 2. Backend

- `apps/api/src/secrets/dto/create-secret.dto.ts`: add `environment?: Environment`, validated with `@ValidateIf((dto) => dto.type === SecretType.ios_provisioning_profile) @IsEnum(Environment)` — required for that type, ignored/absent for the others.
- `SecretsService.create()`: scope the "delete existing secret of same type" query by `(projectId, type, environment)` instead of `(projectId, type)` — otherwise uploading a staging profile would silently delete the production one and vice versa. For `ios_certificate`/`android_keystore`, `environment` stays `null` on both sides of the comparison, so behavior is unchanged.
- `SecretsService.getDecryptedForPlatform(userId, projectId, platform, environment: Environment)`: add the parameter; for iOS, look up `ios_provisioning_profile` matching `environment` specifically (`ios_certificate` lookup stays environment-agnostic, matches the single stored doc).
- `apps/api/src/internal/run-tokens.service.ts`: `issueToken()` params gain `environment: Environment`; `BuildsService.create()`/`createSingle()` passes `dto.environment` through (it already has this value in scope).
- `InternalSecretsController.getSecrets()`: pass `environment` from the consumed token into `getDecryptedForPlatform(...)`.

## 3. GitHub workflow template

- `apps/api/src/github/workflow-template.ts`, iOS "Export IPA" step: replace the hardcoded `ad-hoc` in the generated `exportOptions.plist` with a shell conditional on `inputs.environment` (`ad-hoc` for staging, `app-store` for production). Rename the step (currently "Export IPA (Ad Hoc)") since it's now environment-dependent.
- No change needed to the "Fetch signing secrets" step's shape — it already calls the same internal endpoint; the endpoint itself now returns the environment-correct profile.
- **This step cannot be meaningfully unit-tested** (it's a YAML/shell string template, no existing test file covers its content today). The only real validation is running an actual `production` build against a real Apple Developer certificate + App Store provisioning profile pair on a macOS runner. Flag this explicitly to whoever reviews feasibility — it's the highest-risk, least-verifiable part of this plan from inside this repo alone.

## 4. Frontend

- `apps/web/src/app/core/projects/project.models.ts`: add `environment?: Environment` to `Secret`, `CreateSecretPayload`.
- `apps/web/src/app/features/projects/secrets/project-secrets.ts`:
  - Add an environment `<select>` (Staging/Production), shown only when `type === 'ios_provisioning_profile'`, required.
  - Stored-secrets list: label provisioning profiles with their environment (e.g. "iOS Provisioning Profile — Staging (Ad Hoc)" / "— Production (App Store)") so both can coexist visibly instead of looking like duplicates.
  - `submit()`'s optimistic list update (`list.filter((s) => s.type !== type)`) needs to also filter by `environment` for `ios_provisioning_profile`, or it'll locally (visually) drop the sibling-environment entry until the next reload even though the backend didn't touch it.

## 5. Migration (existing data)

Projects that already uploaded a single `ios_provisioning_profile` have no `environment` set. Two options, pick one before implementing:
- (a) Treat existing profile-less docs as `environment: 'staging'` (matches today's de facto behavior — everything currently exports Ad Hoc) via a one-off Firestore migration script updating existing `ios_provisioning_profile` docs. Users who want production/App-Store builds must upload a second profile afterward.
- (b) Leave existing docs with `environment: null`/undefined and have `getDecryptedForPlatform` fall back to treating an unscoped profile as usable for staging only, erroring clearly for production until the user uploads one. Avoids a migration script but adds a fallback branch that outlives its usefulness.

Recommend (a) — matches this repo's existing convention of small one-off migration scripts over runtime fallback branches (see `FREEMIUM_PLAN.md` → "Firestore migrations: create a migration script to add fields to users" under Key Integration Points).

## 6. Tests

- Unit: `SecretsService.create()` — uploading a production profile does not delete an existing staging profile (and vice versa); uploading a new staging profile does replace the old staging one.
- Unit: `SecretsService.getDecryptedForPlatform()` — returns the profile matching the requested environment, `null` if that environment's profile isn't uploaded yet (distinct from "no profile at all").
- Unit: `RunTokensService`/`InternalSecretsController` — environment round-trips from `issueToken()` through `consumeToken()` to the returned secrets payload.
- No meaningful automated test for the workflow YAML/export-method change — see §3, this needs a real run.

## Open questions for the reviewing agent

1. Verify the core Apple signing assumption in "Core design decision" above — is a shared Distribution certificate really sufficient across Ad Hoc and App Store exports, or does this need per-environment certificates too?
2. Is `xcodebuild -exportArchive` with `method: app-store` sufficient on its own, or does an App Store export in this pipeline's manual-signing setup need additional `exportOptions.plist` keys (e.g. `uploadSymbols`, `destination`) that Ad Hoc doesn't?
3. Any concern with the migration approach in §5 (option a) versus leaving it as a runtime fallback?
