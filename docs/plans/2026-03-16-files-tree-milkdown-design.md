# Files Route Tree + Milkdown Preview Design

## Goal
Add a new `#/files` route with a two-pane layout: file tree on the left and markdown preview on the right. Use parser output markdown and render with Milkdown.

## Confirmed Decisions
- `Files` is a main route (`#/files`).
- Left pane has an `Add` button.
- `Add` uses `vfs.mount` (not `mountInternal`) after selecting a local directory.
- Show all files in tree; unrenderable content can show fallback/error.
- Markdown rendering uses Milkdown.

## Architecture
- Main process RPC exposes Files APIs:
  - `pickAndMountLocalDirectory`
  - `listFilesNodes`
  - `getFileMarkdown`
- Renderer consumes APIs via existing Electrobun RPC bridge.
- Files UI lazily loads tree children and fetches markdown on file click.

## Data Flow
1. Open `#/files` -> load root nodes (`parentNodeId: null`).
2. Expand folder/mount -> load children for that node.
3. Click file -> call parser materialize API and render markdown in Milkdown.
4. Click `Add` -> open directory picker -> mount local dir -> refresh root tree.

## Error Handling
- Picker cancelled: no-op.
- Mount failure: non-blocking error toast/inline message.
- Parser failure: right pane error state.
- Non-file click: clear preview placeholder.

## Testing
- App route test includes `#/files` panel render.
- Existing chat/search route tests remain green.
- Parser/model tests unaffected.
