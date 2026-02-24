# Model Download Verify + Retry Design

## Background
- The model download pipeline already supports resume via `.part` files, automatic retries, manual retry, and progress display.
- Current issues:
  - Startup readiness checks are not explicit enough, which can trigger unnecessary downloads.
  - Progress and task states are confusing at edge cases (for example, `running` near 100%).
  - Failure/retry and `.part` cleanup need clearer task-level control.

## Goals
1. At startup, verify whether embedding/reranker can run locally; if yes, skip download.
2. If not runnable, fetch the remote file list and total size first, then compute progress from local downloaded bytes.
3. Keep download order fixed: embedding first, reranker second; download files concurrently within a model.
4. On failure, apply exponential-style backoff retries and allow immediate `Retry now` from UI.
5. Stop auto-retry after max attempts and clean stale `.part` files.

## Selected Approach (Option B)
- Startup stage: verify both models in parallel using true local load (`local_files_only`).
- Download stage: task-level sequential (embedding -> reranker), file-level concurrent.
- Progress stage: aggregate using remote `siblings[].size` + local final/part bytes; never show 100% while still running.
- Failure stage: task-level backoff retry + manual retry; cleanup `.part` when exhausted.

## Architecture and Flow
1. `startupVerify()`
- Input: current config
- Behavior:
  - Run local runtime verification for embedding/reranker in parallel
  - Classify each task as `ready | partial_or_missing | disabled`

2. `downloadMissing()`
- Download only tasks marked `partial_or_missing`
- Fixed order: embedding -> reranker
- Per task:
  - Fetch remote `siblings` list (with size)
  - Scan local final files and `.part`
  - Download files concurrently with Range resume
  - Run local integrity/runtime verification after download

3. `retry controller`
- Task-level retry counter + backoff (for example 3s/10s/30s)
- Stop auto-retry when exhausted (`exhausted=true`)
- `Retry now`: clear timer and retry the failed task immediately

## State Model
- Global phase: `verifying | running | completed | failed`
- Task state: `verifying | pending | downloading | ready | failed | skipped`
- Progress:
  - Denominator: total remote bytes for pending download tasks
  - Numerator: local downloaded bytes (final + `.part`, capped by remote size)
  - While running and not fully finished: max visible progress is `99.9%`

## UI/Interaction
- Status page should show:
  - phase, progress, triggeredBy, lastStartedAt, lastFinishedAt
  - per-task state, retry attempt, next retry countdown
  - `Retry now` only on failed tasks (hidden while running)

## Failure Strategy and Cleanup
- Recoverable errors:
  - network interruption, Range failure, transient read errors -> retry with backoff
- Non-recoverable/corruption:
  - integrity check failure -> clear cache and retry once
- After exhaustion:
  - cleanup related `.part` files to avoid long-term disk garbage

## Verification Plan
1. Startup verify:
- runnable locally -> skip download
- partial files -> enter download
2. Progress:
- known sizes -> byte-based growth
- unknown size files -> never cause premature 100%
3. Ordering and concurrency:
- task order is embedding -> reranker
- per-model file concurrency works
4. Retry:
- auto backoff triggers, exhaustion stops, manual retry works
5. Guardian:
- indexing/reranker waits for the same in-flight model readiness promise

## Risks and Constraints
- If remote sizes are missing, progress precision degrades and must remain conservative.
- Large repositories may require strict per-model concurrency limits to avoid I/O spikes.

## Conclusion
- Option B is selected to balance startup reliability and download throughput.
- "Parallel verify + ordered task download + per-task file concurrency + task-level retry" satisfies the requirements.
