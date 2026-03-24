# Capability-Aware Index Queues Design

## Goal

Allow text indexing to start as soon as the embedding model is ready, while image indexing waits for OCR and caption models, without running text and image indexing in parallel.

## Scope

In scope:

- split incremental indexing into text and image queues
- keep a single execution slot so only one indexing job runs at a time
- schedule queue consumption based on current model readiness
- let worker startup return before all models are ready
- keep the existing renderer UI contract unchanged in the first iteration

Out of scope:

- renderer changes for separate queue depths or active queue labels
- multiple concurrent index workers
- partial image indexing when only OCR or only caption is ready
- queue priority tuning beyond simple oldest-job-first fairness

## Current Problem

The current worker model ties queue consumption to startup readiness. If startup waits for all models, text indexing is delayed unnecessarily. If startup returns before all models are ready and the queue stays single FIFO, an image job can block the worker while OCR or caption is still unavailable.

The desired behavior is:

- text files begin indexing once embedding is ready
- image files begin indexing once embedding, OCR, and caption are all ready
- only one indexing job runs at any given time

## Architecture

### Two Queues, One Execution Slot

The worker should maintain three queue kinds:

- `delete`
- `text`
- `image`

`delete` remains model-independent and should always be runnable.

`text` and `image` are both incremental indexing queues, but they have different capability requirements:

- `text`: requires `embedding ready`
- `image`: requires `embedding ready`, `ocr ready`, and `caption ready`

The worker still uses a single index worker thread and a single running job at a time. The difference is that queue selection becomes capability-aware instead of blindly FIFO across all work.

### Scheduling

Queue selection should work like this:

1. if any delete job is runnable, select the oldest delete job
2. otherwise, consider the head job of `text` and the head job of `image`
3. discard any queue whose required models are not ready
4. if both remaining queues are runnable, select the older head job
5. if neither queue is runnable, do not claim a job yet

This preserves fairness while preventing image work from blocking text progress.

## Startup Semantics

Startup should launch model preparation for all configured models:

- embedding
- reranker
- OCR
- caption

But `start` should not block until all of them are ready.

Instead:

- worker services are configured
- model preparation begins
- queue worker starts
- scheduling only allows jobs whose required capabilities are ready

This gives the user earlier text indexing without allowing unsupported work to run prematurely.

## Model Readiness Contract

The scheduler only needs a snapshot-level readiness view:

- `embedding ready` means text indexing may run
- `embedding ready + ocr ready + caption ready` means image indexing may run
- `delete` requires no model readiness

`reranker` is not a gating dependency for indexing. It remains relevant for search, not for enqueue/claim eligibility.

When model task state changes to `ready` or `failed`, the scheduler should be woken up so it can re-evaluate which queue can run next.

## Queue Storage Changes

`index_jobs` should gain a `queue_kind` column with allowed values:

- `delete`
- `text`
- `image`

Enqueue classification happens when incremental jobs are created:

- image suffixes use `image`
- all other currently supported non-image incremental files use `text`
- delete requests use `delete`

Existing stale-job and node-state deduplication behavior should remain intact, but now operate with awareness of `queue_kind`.

## Failure Semantics

### Model Failures

- `embedding failed`
  - text queue is blocked
  - image queue is blocked
- `ocr failed` or `caption failed`
  - text queue continues
  - image queue is blocked

Blocked queues should remain queued rather than being marked failed automatically. The queue is waiting on missing capability, not on per-job corruption.

### Job Failures

Per-job parsing/indexing failures still mark that specific job failed and allow later runnable work to continue.

## Fairness

The first iteration should use a minimal fairness rule:

- compare the oldest runnable head job from `text` and `image`
- run whichever is older

This avoids permanently favoring text once image capability becomes ready.

## UI Boundary

The renderer should remain unchanged in this iteration.

Model status already shows per-model readiness. That is sufficient for now. Queue-level split visibility can be added later once the execution behavior is stable.

## Testing

### Queue Tests

- text and image incremental jobs are classified into separate queue kinds
- if image queue head is not runnable and text queue head is runnable, text is claimed
- once OCR and caption become ready, image jobs become claimable
- delete jobs remain claimable regardless of model state

### Worker Integration Tests

- startup returns before OCR/caption finish while text jobs still progress once embedding is ready
- image jobs stay queued until image capability is ready
- image jobs begin processing after OCR and caption become ready
- only one running job exists at a time

### Regression Tests

- stale-job replacement still works with queue kinds
- delete semantics are unchanged
- parser and search behavior are unchanged once a job is actually executed

## Recommended First Iteration

1. add `queue_kind` to queue storage
2. classify incremental jobs into `text` or `image`
3. replace FIFO claim with capability-aware queue selection
4. make startup asynchronous with respect to non-core model readiness
5. wake the queue worker when model readiness changes
6. keep renderer UI unchanged
