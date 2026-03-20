# Search Page State And Scroll Follow-up

## Goal

Keep search page state when switching routes and ensure the search page supports internal scrolling for long result lists and previews.

## Decision

Do not unmount route panels when navigating. Keep `ChatPanel`, `SearchPanel`, and `FilesPanel` mounted and toggle visibility with layout classes. This preserves local component state without pushing search-specific state into `App.tsx`.

For scrolling, make the search page a `min-h-0 overflow-hidden` container with independently scrollable result and preview panes.

## Scope

- `AppShell` route rendering strategy
- `SearchPanel` layout/scroll behavior
- Renderer tests covering state retention and scroll-safe layout
