# Parser Package Design

**Date:** 2026-03-10

## Goal

Add a new `packages/parser` workspace package that reads file content from `@knowdisk/vfs`, converts supported files to markdown, segments that markdown into sections, splits sections into retrieval-sized chunks, and exposes the result as `AsyncIterable<ParseChunk>`.

This package is intentionally scoped to parsing only. It does not define indexing, sqlite, vector DB, or application integration behavior yet.

## Scope

In scope:
- Construct parser service with `vfs`, `basePath`, and `logger`
- Read file bytes with `vfs.createReadStream({ id })`
- Convert file content to markdown with `markitdown-ts`
- Parse markdown with `remark`
- Split markdown into semantic sections
- Split section text with a LangChain text splitter
- Emit rich `ParseChunk` records through `AsyncIterable`
- Cache markdown and parse metadata under `basePath`
- Return error or skipped chunks instead of throwing workflow-breaking parse errors

Out of scope:
- Indexing pipeline integration
- sqlite FTS schema mapping
- vector DB schema mapping
- background jobs and retries outside the package
- cross-package source identifier migration

## Constraints

- `basePath` is a local filesystem directory
- Cache validity should use `providerVersion` from VFS metadata
- If `providerVersion` is missing, the parser should conservatively re-parse
- Parser failures should be logged and surfaced as error chunks
- The package should not assume the source file exists on the local filesystem

## Package Boundary

Create a new workspace package:

- `packages/parser/package.json`
- `packages/parser/src/index.ts`

Primary API:

```ts
export type ParserService = {
  parseNode(input: { nodeId: string }): AsyncIterable<ParseChunk>;
  materializeNode(input: { nodeId: string }): Promise<ParseDocument>;
  getCachePaths(input: { nodeId: string }): ParseCachePaths;
};

export function createParserService(input: {
  vfs: VfsOperationCore;
  basePath: string;
  logger: Logger;
  converter?: MarkdownConverter;
  sectionSplitter?: SectionSplitter;
  textSplitter?: TextSplitter;
}): ParserService;
```

`parseNode()` is the main runtime interface. `materializeNode()` exists for tests, debugging, and cache inspection.

## Pipeline

The package uses a fixed five-stage pipeline:

1. `read`
   - Load node metadata through `vfs.getMetadata({ id: nodeId })`
   - Reject non-file nodes
   - Read bytes through `vfs.createReadStream({ id: nodeId })`
2. `convert`
   - Convert bytes to markdown with `markitdown-ts`
   - Extract converter metadata such as title when available
3. `remark`
   - Parse markdown into an AST
4. `section split`
   - Walk heading structure and build semantic sections
5. `text split`
   - Split section text with a LangChain text splitter
   - Emit final `ParseChunk` values

## Cache Layout

Cache content is stored under:

```text
<basePath>/<mountId>/<nodeId>/
```

Files:
- `document.md`: full converted markdown
- `manifest.json`: node metadata and parse metadata
- `error.json`: last parse failure context, only present after failures

Manifest fields:

```ts
type ParseManifest = {
  nodeId: string;
  mountId: string;
  providerVersion: string | null;
  parserId: string;
  parserVersion: string;
  converterId: string;
  converterVersion: string;
  title: string | null;
  createdAt: string;
};
```

Cache hit rule:
- use cached markdown only when `manifest.providerVersion` equals the current node `providerVersion`
- if `providerVersion` is `null`, skip cache reuse and rebuild markdown

## Core Types

```ts
export type ParseDocument = {
  node: VfsNode;
  sourceUri: string;
  providerVersion: string | null;
  title: string | null;
  markdown: string;
  parserId: string;
  parserVersion: string;
  converterId: string;
  converterVersion: string;
  sections: ParseSection[];
};

export type ParseSection = {
  sectionId: string;
  heading: string | null;
  depth: number | null;
  sectionPath: string[];
  markdown: string;
  text: string;
  charStart: number;
  charEnd: number;
};

export type ParseChunkStatus = "ok" | "skipped" | "error";

export type ParseChunk = {
  chunkIndex: number;
  text: string;
  markdown: string | null;
  title: string | null;
  heading: string | null;
  sectionId: string | null;
  sectionPath: string[];
  charStart: number | null;
  charEnd: number | null;
  tokenEstimate: number | null;
  source: {
    nodeId: string;
    mountId: string;
    sourceRef: string;
    sourceUri: string;
    name: string;
    kind: "file";
    size: number | null;
    mtimeMs: number | null;
    providerVersion: string | null;
  };
  parse: {
    parserId: string;
    parserVersion: string;
    converterId: string;
    converterVersion: string;
  };
  status: ParseChunkStatus;
  error?: {
    code: string;
    message: string;
  };
};
```

Design notes:
- `ParseChunk` carries source and parser metadata directly so later storage layers can map fields without reparsing
- `markdown` is retained per chunk when available because some downstream renderers or citation systems may want markdown-preserving excerpts
- offsets are character offsets within the converted markdown, not byte offsets of the original binary file

## Source Identity

The package should expose a stable source identifier without assuming a local path:

```ts
sourceUri = `vfs://${mountId}/${nodeId}/${encodeURIComponent(node.name)}`;
```

This is parser-local for now. Mapping to app-wide retrieval identifiers is deferred to integration work.

## Error Handling

The package should not break the consumer's iteration flow for expected parse failures.

Behavior:
- unsupported file type: return one `status: "skipped"` chunk and log at warn or error level
- conversion failure: return one `status: "error"` chunk and log the error
- empty markdown or empty extracted text: return one `status: "skipped"` chunk and log the reason
- malformed markdown AST handling failures: return one `status: "error"` chunk and log the error

Error chunks:
- keep `text` empty
- keep source metadata populated
- include `error.code` and `error.message`
- set section and offset fields to `null` when unavailable

The package may still throw for programmer errors such as invalid constructor arguments or impossible internal states.

## Section Splitting

Section splitting should be heading-aware:
- top-level content before the first heading becomes a synthetic preamble section
- each heading starts a new section
- nested headings produce a `sectionPath` representing the heading stack

Example:

```md
# Intro
## Install
## Usage
# API
```

Produces section paths:
- `["Intro"]`
- `["Intro", "Install"]`
- `["Intro", "Usage"]`
- `["API"]`

## Text Splitting

LangChain splitting runs after sectioning.

Requirements:
- preserve section metadata on every derived chunk
- compute `charStart` and `charEnd` relative to the full markdown text when practical
- compute `tokenEstimate` for each final chunk
- skip empty or whitespace-only chunks

The package should accept an injected text splitter so chunk sizing policy can change later without redesigning the package.

## Dependencies

Expected package dependencies:
- `@knowdisk/vfs`
- `markitdown-ts`
- `remark`
- `unist` traversal utilities if needed
- `@langchain/textsplitters` or the current LangChain splitter package used by the repo
- `pino` types or logger-compatible interface

## Testing Strategy

Tests should focus on the package boundary and pipeline behavior.

Required coverage:
- reads file bytes from VFS and converts to markdown
- caches markdown by `providerVersion`
- rebuilds cache when `providerVersion` changes
- does not reuse cache when `providerVersion` is absent
- creates heading-aware sections
- splits large sections into multiple chunks while preserving metadata
- returns skipped chunk for unsupported or empty content
- returns error chunk and writes `error.json` when conversion fails

## Open Decisions Deferred

These are intentionally postponed:
- exact file extension and MIME support matrix
- final chunk ID generation
- exact sqlite FTS column mapping
- exact vector metadata mapping
- integration with existing `src/core/parser` or replacement strategy

## Recommended Implementation Direction

Implement `packages/parser` as a self-contained workspace package with injectable converter and splitters, but default to `markitdown-ts`, `remark`, and a LangChain text splitter. Keep the public surface small and metadata-rich. Defer all storage and indexing concerns until the package contract is proven by tests.
