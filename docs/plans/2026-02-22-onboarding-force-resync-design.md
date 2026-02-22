# Know Disk Onboarding + Force Resync Design

## Context
Current app has `Home` and `Settings` tabs, with runtime config persisted via `ConfigService` and backend actions exposed through Bun RPC. Initial config may have empty `sources`, but app still allows entering Home. There is no guided onboarding and no one-click destructive resync for vector storage.

## Goals
- Add a first-run onboarding flow.
- First run requires user to select at least one source.
- Second step configures embedding/reranker (with defaults prefilled and editable).
- On completion, user enters Home and normal app navigation.
- Add `Force Resync` on Home: destroy vector storage then rebuild index from configured sources.

## Non-goals
- Reworking retrieval/reranking architecture.
- Adding multi-user profiles.
- Automatic rollback if force resync fails mid-rebuild.

## UX Flow
### First run (`onboarding.completed = false`)
1. App launches into onboarding instead of Home/Settings.
2. Step 1 (`Sources`):
   - User must add at least one source.
   - `Next` disabled until `sources.length > 0`.
3. Step 2 (`Embedding + Reranker`):
   - Default values prefilled from config defaults.
   - User can edit, but may continue without changes.
   - On continue: save config and set `onboarding.completed = true`.
4. App switches to normal shell (`Home/Settings`, default Home).

### Returning users (`onboarding.completed = true`)
- App opens normally, regardless of current source count.

### Home Force Resync
- User clicks `Force Resync` button.
- Immediate execution (no confirmation dialog):
  1. Destroy vector collection/storage.
  2. Recreate vector store.
  3. Trigger `runFullRebuild("force_resync")`.
- Button disabled while operation is in progress.
- Show success/failure feedback message.

## Architecture
### Config model changes
Extend `AppConfig` with:
- `onboarding: { completed: boolean }`

Defaults:
- `onboarding.completed = false`

Migration:
- For v1 config missing `onboarding`, inject default.
- Keep existing user settings unchanged otherwise.

### Frontend composition
- `App.tsx` acts as guard:
  - If `onboarding.completed === false`, render `OnboardingPage`.
  - Else render current app shell (`Home/Settings`).
- New onboarding components:
  - `OnboardingPage`
  - `SourceSelectionStep`
  - `ModelSetupStep`
- `SettingsPage` remains configuration screen, not onboarding screen.

### Shared model config logic
To avoid duplicated form logic:
- Extract embedding/reranker state handling into reusable hook/helper.
- `SettingsPage` and onboarding step 2 use same config save behavior.

### Backend force resync
Expose RPC endpoint:
- `force_resync -> { ok: boolean; error?: string }`

Server-side execution pipeline:
1. Destroy vector collection artifacts (repository-level destructive operation).
2. Recreate/open vector repository with current provider+dimension path.
3. Invoke indexing full rebuild with reason `force_resync`.

## Data Flow
### Onboarding completion
1. Onboarding step 2 continue clicked.
2. Update config (embedding/reranker edits if any).
3. Update config onboarding flag to true.
4. App rerenders into normal shell.

### Force resync
1. Home button triggers RPC `force_resync`.
2. Backend executes destroy + rebuild.
3. RPC returns success/failure payload.
4. Home shows operation status text and unlocks button.

## Error Handling
- Source picker canceled: noop, no error toast.
- Source add RPC failure: keep user on step 1, show actionable error.
- Step 2 save failure: stay on step 2 and show error.
- Force resync failure: show error in Home and keep app running.
- Force resync during active indexing: button disabled to avoid concurrent destructive operations.

## Testing Strategy
- Config migration tests:
  - Missing onboarding field gets default `completed=false`.
- App guard tests:
  - `completed=false` renders onboarding.
  - `completed=true` renders Home/Settings.
- Onboarding tests:
  - No source => cannot proceed from step 1.
  - Add source => can proceed.
  - Step 2 defaults allow continue without edits.
  - Completing onboarding sets config flag true.
- Force resync tests:
  - Home button triggers RPC.
  - Button disabled while running.
  - Success/failure state text shown.
- Backend tests:
  - `force_resync` calls vector destroy/recreate and indexing rebuild in correct order.

## Rollout Notes
- Existing users with persisted config will get `onboarding.completed=false` unless migrated explicitly. For compatibility, migration should set:
  - `completed=true` when existing config already has at least one source; else false.
  This prevents forcing onboarding on mature installs.
