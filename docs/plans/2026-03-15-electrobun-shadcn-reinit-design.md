# Electrobun Shadcn Reinitialization Design

## Goal

Replace the current host app under `src/` with a fresh Electrobun + shadcn/ui shell while leaving `packages/*` untouched and temporarily independent.

## Scope

This redesign only applies to the application host layer in `src/` and the root build configuration needed to boot it. It does not integrate any of the existing package libraries yet.

In scope:

- Remove the current `src/` implementation.
- Rebuild a minimal Electrobun app shell.
- Rebuild the renderer as a React + Vite app using shadcn/ui primitives.
- Keep `packages/core`, `packages/model`, `packages/indexing`, `packages/parser`, and `packages/vfs` unchanged.

Out of scope:

- Reconnecting existing package services to the new shell.
- Preserving old `src/core` behavior.
- Migrating old tests for app-level features.

## Recommended Approach

Use a minimal host reset rather than a feature-complete rewrite. The new app should only provide:

- an Electrobun main process entry,
- a React renderer entry,
- a basic application shell UI,
- shadcn/ui setup and a few foundational components.

This keeps the reset small and makes later package integration explicit instead of dragging old architecture into the new host.

## Target Structure

The rebuilt `src/` should contain only:

- `src/bun/`
  - Electrobun main process bootstrap
  - window creation and lifecycle wiring
- `src/renderer/`
  - React entrypoint
  - app shell
  - shadcn/ui-backed components
  - shared renderer styles and utilities
- `src/types/`
  - Electrobun-related ambient types needed by the new shell

The following current areas are intentionally removed:

- `src/mainview/**`
- `src/core/**`
- the existing `src/bun/**`
- the current Electrobun shim types

## Configuration Strategy

Reuse the existing root workspace and most root config where practical:

- keep `package.json`,
- keep `electrobun.config.ts`,
- keep Tailwind/PostCSS/Vite config and adjust only what the new renderer needs,
- allow `components.json` if shadcn/ui initialization requires it.

This avoids unnecessary churn outside the host app reset.

## UI Direction

The new renderer starts as a clean shell, not a business app. It should include:

- a simple desktop frame layout,
- a primary content panel,
- a lightweight sidebar or header for navigation affordance,
- placeholder cards showing that package integrations will be connected later.

The UI should use shadcn/ui primitives and avoid carrying over the old page structure.

## Verification

Because `src/` is being reset, host-app tests tied to the old implementation should be removed or rewritten as part of the reset. Package tests remain the safety net.

Required verification:

- `bun install`
- `bun run lint`
- `bun test packages/core/src packages/model/src packages/indexing/src packages/parser/src packages/vfs/src`
- `bun run build`

Optional manual verification:

- `bun run dev`

## Execution Notes

Implementation should happen in a dedicated git worktree because this is a destructive host-layer rewrite.
