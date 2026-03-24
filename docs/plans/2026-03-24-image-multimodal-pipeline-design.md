# Image Multimodal Pipeline Design

## Goal

Add a dedicated image-file parsing pipeline that bypasses Docling for image inputs and produces multimodal chunks composed from OCR text, caption text, and image metadata before the existing embedding and vector-db indexing stages.

## Scope

In scope:

- route image files away from the current Docling parser path
- run PaddleOCR and Moondream for image parsing
- merge OCR, caption, and metadata into multimodal chunks
- manage OCR and caption models through `ModelService` and `ModelArtifactManager`
- define all image-model configuration in `CoreConfig`
- pass only the Python-relevant config subset from Bun to Python startup

Out of scope:

- changing the downstream vector repository schema
- introducing a separate image indexing service outside the parser boundary
- region-level multi-chunk indexing in the first iteration

## Architecture

### Parser Boundary

Image routing happens in `python/worker/parser/service.py`. Image suffixes no longer use the Docling code path. Instead, `parse_node(...)` dispatches image files to a new `parse_image_document(...)` pipeline.

This keeps the current boundary intact:

- parser decides how to interpret a file
- index service embeds returned chunks
- vector db stores embedded chunks

### New Image Pipeline

`parse_image_document(...)` orchestrates:

1. resolve local image path
2. acquire verified OCR runtime from `ModelService`
3. acquire verified caption runtime from `ModelService`
4. run OCR with PaddleOCR
5. run captioning with Moondream
6. merge outputs into a multimodal chunk
7. return `ParsedChunk[]` compatible with the current indexing path

## Data Model

### Chunk Strategy

First iteration uses one multimodal chunk per image.

Rationale:

- preserves compatibility with the current embedding path
- avoids premature region-level chunk explosion
- keeps retrieval simple while still preserving structured metadata for later refinement

### Chunk Text Layout

The chunk text should be deterministic and human-readable:

```text
Image caption:
<caption text>

Image OCR:
<merged ocr text>

Image metadata:
path=<path>
page=<page or null>
regions=<count>
```

### Chunk Metadata

The parsed chunk output should carry or derive structured image metadata sufficient for artifact generation and future search refinement:

- `path`
- `page`
- `caption`
- `ocrText`
- `regions`
  - region id
  - bounding box
  - recognized text

If current parser types do not have an explicit metadata field, the first implementation may serialize the structured metadata into the multimodal chunk text and markdown artifact while introducing the typed metadata extension in a follow-up-compatible way.

## Configuration

### CoreConfig

Add image-model sections to `CoreConfig`:

- `ocr`
  - `provider`
  - `local.model`
- `caption`
  - `provider`
  - `local.model`

First iteration supports only `local` providers for both.

`providers.huggingface.endpoint` remains the shared download endpoint for:

- embedding
- reranker
- OCR
- caption

### Bun To Python Startup

Bun remains the owner of `CoreConfig`. At startup it passes only the Python-relevant subset:

- `embedding`
- `reranker`
- `ocr`
- `caption`
- `providers.huggingface`

Python continues to receive scalar startup fields for direct runtime use, plus the config subset for consistency and future feature growth.

## Model Management

### ModelService Extensions

`ModelService` expands from two managed runtime classes to four:

- embedding
- reranker
- OCR
- caption

It remains the only source of verified model runtimes. Callers must not construct OCR or caption runtimes directly.

### Artifact Management

`ModelArtifactManager` remains the single download and file-verification boundary.

It must be extended with:

- OCR artifact file selection rules
- caption artifact file selection rules
- local artifact completeness checks for OCR and caption

### Verification Contract

The same contract used by embedding/reranker applies:

- download through `ModelArtifactManager`
- validate local artifacts
- initialize runtime
- only then return runtime to the caller

If verification fails, the runtime is not exposed.

## Error Handling

### Parser Failures

Image parsing failures should degrade at parser level, not crash the worker process.

Expected behavior:

- OCR runtime unavailable: parser returns error chunk
- caption runtime unavailable: parser returns error chunk
- OCR succeeds but caption fails: parser returns error chunk in first iteration for consistency
- malformed image input: parser returns error chunk

This matches current parser behavior better than partially indexed image results.

### Logging

Add image-stage diagnostics similar to current Docling and embedding logs:

- image parse started
- OCR started / finished
- caption started / finished
- multimodal merge finished

## Testing

### Parser Tests

- image suffix routes to `parse_image_document`, not Docling
- multimodal chunk text format is stable
- metadata merge includes caption, OCR text, and region data
- failures surface as parser error chunks

### Model Tests

- OCR artifact selection
- caption artifact selection
- local completeness checks
- verified runtime acquisition for OCR and caption

### Integration Tests

- image file indexes through full service stack
- image search can retrieve multimodal chunk content
- parser artifact markdown is written for image nodes

## Recommended First Iteration

1. route image suffixes to a new parser path
2. add `ocr` and `caption` config to `CoreConfig`
3. extend startup config transfer from Bun to Python
4. add OCR and caption artifact/runtime management to `ModelService`
5. produce one multimodal chunk per image
6. keep downstream embedding and vector-db flow unchanged

This delivers the new functionality with minimal disruption to the rest of the indexing stack.
