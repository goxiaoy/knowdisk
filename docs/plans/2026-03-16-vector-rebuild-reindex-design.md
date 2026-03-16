# Vector Rebuild Reindex Design

## Goal
When the local vector index is detected as corrupted and automatically recreated, the app should remain usable and trigger a background full reindex of existing supported files. The sidebar Vector DB indicator should surface rebuild progress while continuing to poll for status.

## Approach
- Extend `VectorRepository` with a one-shot recovery state flag indicating that the on-disk collection was rebuilt due to recoverable corruption.
- On app startup, `initializeAppRuntime` checks that flag and, if set, starts a non-blocking background reindex task.
- The task walks mounted VFS nodes, filters to parser-supported files, and reuses the existing parser/indexing pipeline per file.
- Rebuild status is exposed through Bun RPC and folded into the existing Vector DB sidebar indicator.

## Data Flow
- `createVectorRepository()` recovers the collection and marks `recovered = true`.
- `initializeAppRuntime(app)` consumes that flag and launches background reindex.
- Renderer polls `getVectorDbStatus()` and renders `idle`, `rebuilding`, or `error` with chunk count and progress.

## Error Handling
- Individual file parse/index failures are logged and do not abort the rebuild.
- Rebuild-level failures surface as `error` state in the Vector DB status.
- UI remains interactive throughout.

## Testing
- Repository test for recovery flag behavior.
- App container/runtime test for startup-triggered full reindex after recovery.
- Renderer test for Vector DB status rendering during rebuild.
