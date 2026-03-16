# Global Model Status Indicator Design

## Summary
Add a global status indicator icon in the top-right of the main content area. The indicator reflects model-service background task state with color and motion only. On hover, it reveals per-model status and percentage details.

## Confirmed Decisions
- Scope: global UI element across chat/search views.
- Visual form: icon-only status light (no always-visible text).
- Details: hover card with model rows and percentages.
- Data source: model service status via push-based listening from main process.

## Placement
- Render in right-panel shell (top-right overlay) so it is always visible across routes.
- Keep layout-independent from route content blocks.

## Status Semantics
- `running` / `verifying`: cyan/blue active glow + pulse.
- `completed`: green static.
- `failed`: red static with subtle breathe.
- `idle` / unavailable: neutral gray.

## Hover Content
- Header: overall phase and aggregate percent.
- Rows:
  - Embedding model: state + percent
  - Reranker model: state + percent
- Empty task fallback: `Not started`.
- Data unavailable fallback: `Unavailable`.

## Data Architecture
- Main process subscribes to `modelService.getStatus().subscribe`.
- Main process pushes updates to renderer via Electrobun RPC message.
- Renderer initializes RPC, requests snapshot once, then listens for pushed updates.

## Error Handling
- RPC init failure should not block app rendering.
- On transport failures, keep last known status; fallback to neutral indicator.
- Clamp displayed percent to `0..100`.

## Testing
- Renderer tests cover:
  - global status indicator renders on chat and search routes
  - hover card structure includes model rows
  - route behavior remains unchanged
