# Parser Example Hook Design

**Date:** 2026-03-10

## Goal

Add a parser example that mounts a local VFS directory, listens to VFS `afterUpdateContent` events, calls `parseNode()` for each synced file node, and prints emitted `ParseChunk` records to the terminal.

## Scope

In scope:
- add a standalone parser example under `packages/parser/example`
- mount a local VFS provider that points at `packages/parser/example/data`
- include sample markdown, image, pdf, and json files in that directory
- create a parser service backed by the mounted VFS
- register a VFS node event hook for `afterUpdateContent`
- parse the updated node through `parseNode({ nodeId })`
- print `ParseChunk` output to stdout

Out of scope:
- HTTP server or UI for the example
- integration with indexing, sqlite FTS, or vector DB
- OCR or guaranteed success for image/pdf conversion

## Architecture

The example lives independently from the existing `packages/vfs/example` server demo.

New files:
- `packages/parser/example/app.ts`
- `packages/parser/example/logger.ts`
- `packages/parser/example/data/hello.md`
- `packages/parser/example/data/info.json`
- `packages/parser/example/data/paper.pdf`
- `packages/parser/example/data/image.png`
- optional `packages/parser/example/app.test.ts`

Runtime flow:
1. create example runtime directories for `vfs.db`, synced VFS content, and parser cache
2. create VFS repository, registry, and service
3. create parser service with `basePath=<runtime>/parser-cache`
4. mount the local provider to `packages/parser/example/data`
5. register `afterUpdateContent`
6. call `vfs.start()`
7. initial content sync triggers the hook for existing files
8. hook parses the file node and prints each `ParseChunk`

## Hook Contract

The example uses:

```ts
vfs.registerNodeEventHooks({
  async afterUpdateContent(ctx) {
    if (ctx.nextNode?.kind !== "file") {
      return;
    }

    for await (const chunk of parser.parseNode({
      nodeId: ctx.nextNode.nodeId,
    })) {
      printChunk(ctx.nextNode, chunk);
    }
  },
});
```

Only file nodes are parsed. Folder and mount nodes are ignored.

## Output Format

The example prints compact one-line records:

- file line:
  - `[PARSE] sourceRef=... nodeId=... providerVersion=...`
- chunk line:
  - `[CHUNK] status=ok|skipped|error index=... heading=... tokens=... text="..."`

Error and skipped chunks include:
- `code`
- `message`

This keeps the example readable while still showing chunk metadata.

## Sample Data Expectations

The example data folder includes:
- `hello.md`: expected to emit normal `ok` chunks
- `info.json`: expected to emit normal `ok` chunks through text conversion
- `paper.pdf`: may emit `ok` chunks or parser `error` chunks depending on converter support/runtime
- `image.png`: expected to demonstrate parser fallback through `skipped` or `error` chunks

The example is successful as long as it demonstrates hook-driven parse attempts and visible output for both success and fallback paths.

## Package Contract Changes

Minimal package changes:
- add an example script to `packages/parser/package.json`
- optionally add a small example-specific helper if terminal formatting would otherwise duplicate parser internals

The parser package itself should not gain server-oriented or example-only runtime APIs.

## Testing Strategy

Prefer one lightweight example test:
- start the example against a temp local data directory
- assert that markdown/json produce at least one `ok` chunk line
- assert that png/pdf produce parse output attempts with `status=error` or `status=skipped`

Do not hardcode pdf/image successful parsing as a test requirement.

## Recommendation

Implement the parser example as a dedicated CLI-style demo in `packages/parser/example`. Keep it small, event-driven, and terminal-first. Reuse VFS runtime pieces directly, but do not couple it to the existing VFS example server.
