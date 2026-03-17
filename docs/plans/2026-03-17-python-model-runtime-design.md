# Python Model Runtime Design

## Goal

Replace the legacy TypeScript `packages/model` runtime with a Python-owned model runtime that supports:

- Python-side model download and cache management
- resumable downloads with progress reporting
- verify-by-load instead of hash verification
- Bun-provided default model selection
- local embedding and reranker runtimes for indexing and search

The first release target is packaged macOS with `mps` and `cpu` as the supported execution devices. The design keeps `cuda` as a future-capable runtime preference without making it a packaging requirement in this phase.

## Current State

The legacy TypeScript model runtime in `packages/model` already implements:

- Hugging Face repository file discovery
- file download and retry behavior
- local cache management
- UI-facing model status updates
- runtime loading for the local embedding and reranker stack

The current Python `worker/model_service.py` does not implement real runtime behavior yet. It only provides a thin state machine with injected verification and loading callbacks.

## Recommended Approach

Use Python-native Hugging Face runtimes for inference and a custom Python artifact manager for downloading.

Recommended stack:

- Embedding: `sentence-transformers` with `Alibaba-NLP/gte-multilingual-base`
- Reranker: `transformers` with `Alibaba-NLP/gte-multilingual-reranker-base`

This avoids carrying over the legacy ONNX-specific download and load assumptions into Python. Python will no longer require ONNX as the default local inference format.

## Runtime Ownership

Bun remains the orchestration layer. Python owns the model lifecycle.

Bun provides the runtime configuration during the worker `start` request:

- `embeddingModel`
- `rerankerModel`
- `preferredDevice`
- `modelCacheDir`
- optional `huggingfaceEndpoint`

Python stores this configuration during worker startup and uses it for all model verification, download, and load operations.

The default model identifiers should be decided by Bun, not hardcoded in Python. The initial Bun defaults are:

- `Alibaba-NLP/gte-multilingual-base`
- `Alibaba-NLP/gte-multilingual-reranker-base`

## Python Architecture

The Python model runtime should be split into three layers.

### 1. ModelService

Responsibilities:

- expose `ensure_required_models()`
- expose `get_local_embedding_runtime()`
- expose `get_local_reranker_runtime()`
- drive UI-facing model status transitions
- cache live runtime instances once loaded

### 2. ModelArtifactManager

Responsibilities:

- list remote model files from Hugging Face
- decide which files are required for each model
- manage download progress
- support HTTP range-based resume
- write into `.part` files and atomically rename on completion
- clear or replace damaged local model directories

### 3. ModelRuntimeLoader

Responsibilities:

- select device from runtime preference and local availability
- load local embedding model from disk
- load local reranker model from disk
- verify model integrity by successfully loading from the prepared local directory

## Cache Layout

The cache layout should separate task kind and repo id.

Proposed layout:

- `<model_cache_dir>/embedding/<repo-id>/...`
- `<model_cache_dir>/reranker/<repo-id>/...`

The artifact manager owns directory creation, `.part` files, and atomic promotion into the final cache directory.

## Download and Verify Flow

### File Discovery

Python fetches the Hugging Face model file list from the configured endpoint and selects the files required for each runtime.

This is no longer ONNX-specific. The selected files should include transformer and sentence-transformer assets such as:

- `config.json`
- `tokenizer.json`
- `tokenizer_config.json`
- `special_tokens_map.json`
- `vocab.*`
- `merges.txt`
- `tokenizer.model`
- `modules.json`
- sentence-transformer config files
- `model.safetensors` or `pytorch_model.bin`

### Download

Each file is downloaded into a `.part` path first. The downloader should:

- detect existing partial size
- issue range requests when possible
- aggregate progress across all required files
- update task progress continuously

### Verify

Verification is defined as successful local model load.

No hash verification is required in this phase. If the local directory can be loaded successfully by the runtime loader, the model is considered valid. If load fails, the model is treated as corrupted and the task moves to `failed`.

## Status Model

The Python model status should continue to map cleanly to the existing UI shape.

Top-level phase:

- `idle`
- `verifying`
- `running`
- `completed`
- `failed`

Per-task state:

- `verifying`
- `pending`
- `downloading`
- `ready`
- `failed`

Behavior:

- Existing local files without a loaded runtime start in `verifying`
- Active transfer shows `downloading`
- Successful verify-by-load shows `ready`
- Any load or download failure shows `failed`

## Device Strategy

Bun passes `preferredDevice` in the worker start payload.

Python resolves actual device in this order:

1. `cuda` if requested and available
2. `mps` if requested and available
3. `cpu`

For this phase, packaged support is only required for `mps` and `cpu`. `cuda` support is a forward-compatible branch of the runtime selection logic, not a current packaging target.

## Bun / Python Protocol Changes

The Python worker `start` payload needs to carry model runtime configuration.

Minimum payload extension:

- `embeddingModel`
- `rerankerModel`
- `preferredDevice`
- `modelCacheDir`
- optional `huggingfaceEndpoint`

Python should reject missing required fields with a clear startup error.

## Testing Strategy

### Python Unit Tests

- file selection for sentence-transformer and reranker models
- resumable download behavior
- progress aggregation
- verify-by-load success and failure
- device resolution

### Python Integration Tests

- local stub model directory loads through the runtime loader
- model service transitions from `verifying` to `completed`
- broken local cache transitions to `failed`

### Bun Tests

- worker `start` request includes model runtime configuration
- Bun-side defaults are passed correctly

### End-to-End Scope

Do not add CI tests that download the real large production models in this phase. End-to-end coverage should rely on injected downloader/loader fakes and lightweight local fixtures.

## Migration Notes

- The Python runtime replaces the legacy TypeScript model lifecycle.
- The default Python implementation should not require ONNX.
- ONNX can remain a future optional backend if later performance work justifies it.
