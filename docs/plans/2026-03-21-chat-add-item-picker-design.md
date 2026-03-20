# Chat Add Item Picker Design

**Goal:** Let users add multiple files to the chat composer by searching inside chat, then display the selected files as removable chips above the input area.

## Context

The current chat panel in [chat-panel.tsx](/Users/goxy/projects/knowdisk/src/renderer/components/shell/chat-panel.tsx) is a static shell. It has an `Add item` button, but no chat composer state, no search integration, and no selected-file UI. The renderer already has a reusable `searchApi` contract wired through [App.tsx](/Users/goxy/projects/knowdisk/src/renderer/App.tsx) and [app-shell.tsx](/Users/goxy/projects/knowdisk/src/renderer/components/shell/app-shell.tsx), and empty search already returns recent files.

That means the missing piece is not backend search. The missing piece is a chat-local picker and selection model.

## Options Considered

### 1. Route to `/search` and return selected files

Reuse the full search page and treat selection as a separate flow.

This is the cheapest in code reuse, but the interaction is wrong for the target UX. It breaks the chat composition flow and does not resemble the inline "Work with Code" attachment pattern.

### 2. Open a modal search dialog from chat

Show a dedicated dialog, perform search there, and commit selections back into chat.

This is workable, but heavy for a first version. It adds overlay lifecycle, escape handling, and focus coordination that the product does not need yet.

### 3. Inline picker inside the chat composer

Open a compact search surface directly inside the chat panel when `Add item` is clicked. Search results are selectable in place, and selected files render as removable chips above the input area.

This is the recommended approach. It matches the intended UX most closely, keeps the user in the chat flow, and reuses the existing search API without overbuilding.

## Recommended Design

### Component ownership

Keep all first-version selection state inside [chat-panel.tsx](/Users/goxy/projects/knowdisk/src/renderer/components/shell/chat-panel.tsx).

`AppShell` should pass `searchApi` into `ChatPanel`, but no state needs to be lifted yet because:

- the selected items are local to the composer
- persistence across routes is not required by the current request
- there is no message-send integration yet

### Picker behavior

When the user clicks `Add item`:

- open a lightweight picker panel inside the composer card
- focus the picker input
- immediately run `searchApi.search({ query: "", titleOnly: false })`

Because empty search already returns recent files, the picker becomes useful before any typing.

As the user types:

- debounce requests slightly, consistent with the search page
- call `searchApi.search`
- show loading, results, and error states inline

### Selection behavior

When the user clicks a result:

- add it to `selectedItems`
- deduplicate by `nodeId`
- keep the picker open so the user can continue selecting more files

Each selected item becomes a chip shown above the main chat input area.

Chip label priority:

1. `title`
2. `name`
3. `sourceRef`
4. `nodeId`

Each chip gets a remove button that deletes only that selected item.

### UI layout

The chat card should gain three stacked regions:

1. top controls row with `Add item`
2. selected item chips
3. optional picker panel
4. main prompt area and footer controls

The chips should visually read like attachments, not tags buried in body text. They should sit close to the prompt area so the association is obvious.

The picker panel should be compact:

- search input
- small results list
- lightweight empty/loading/error states

This should not become a full preview/search experience like `/search`.

### Result rendering

Result rows should show:

- primary label: file name/title
- secondary label: path/snippet

If a result is already selected, the row should render as selected or disabled rather than allowing duplicate insertion.

### Non-goals

The first version does not need:

- message send integration with selected files
- drag-and-drop attachments
- keyboard navigation across picker results
- cross-route persistence of selected chat items
- full markdown preview inside chat picker

## Testing Strategy

### Chat panel tests

Add focused tests for:

- `Add item` opens the picker
- opening the picker triggers empty-query search and shows recent files
- selecting multiple results renders multiple chips
- selecting the same result twice does not duplicate chips
- removing a chip deletes it from the selected list
- picker errors render inline without crashing the chat panel

### App shell integration test

Add or extend an `AppShell` test proving `searchApi` is passed into `ChatPanel` and the chat route can render picker-driven state.

## Risks and Constraints

- The current chat panel is purely presentational, so introducing local UI state will make it a real stateful component. Keep this contained and avoid inventing a broader chat architecture.
- Search result items come from the general search API, so the chip model should reuse `SearchResult` rather than inventing a second attachment type.
- Since the picker depends on empty-query recent files, this feature implicitly depends on the recent-files search behavior already being stable.
