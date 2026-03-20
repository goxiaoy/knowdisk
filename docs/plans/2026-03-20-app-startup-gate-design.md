# App Startup Gate Design

## Goal

Do not reveal the main application shell until the renderer RPC is connected and the first batch of runtime status data has loaded.

## Problem

The renderer currently mounts the main shell immediately with fallback state. That causes transient empty or misleading UI, especially in panels that fetch data on mount before RPC is ready.

## Decision

Add a global startup gate in `App.tsx`.

The app should render:

- a startup loading screen while RPC and initial statuses are loading
- the main `AppShell` only after initialization completes

## Ready Criteria

The gate opens only after:

- RPC bridge is created
- first `getModelStatus`
- first `getVfsStatus`
- first `getIndexStatus`
- first `getVectorDbStatus`

## Failure Behavior

If startup initialization fails, render a startup error state instead of revealing the main shell with fallback business UI.

## Scope

- `App.tsx`
- `App.test.tsx`
- small startup screen markup only; no extra route work
