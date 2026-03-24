# Python Startup Config Design

## Scope

Align Bun's Python worker startup parameters with `CoreConfig`, and pass only the Python-relevant configuration subset through the startup request.

## Current Gap

`packages/core` defaults still point at older local model ids, while Bun startup hard-codes different model ids directly in `src/bun/index.ts`. Python therefore does not start from the same config source as the rest of the app.

## Approach

Keep `CoreConfig` as the source of truth in Bun. Add a small mapping layer that derives Python startup params from `CoreConfig`, including:

- `embeddingModel`
- `rerankerModel`
- `preferredDevice`
- `huggingfaceEndpoint`
- a minimal `coreConfig` subset containing only Python-relevant embedding, reranker, and provider settings

Python continues to use the existing scalar fields for runtime setup. The config subset is passed for consistency and future Python-side use, without coupling Python to the entire Bun config surface.

## Verification

Cover the mapping with Bun tests and update shared Python worker frame validation tests so the new optional config payload is accepted.
