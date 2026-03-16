# Remio-Style Chat/Search Shell Design (KnowDisk)

## Context
Current renderer uses a placeholder dashboard. The user requested a Remio-like left-right layout with `Chat` and `Search` as main features, plus a `Knowledge Base` section with `Files` as the option.

## Goals
- Build a two-column desktop shell close to the provided reference style.
- Keep `Chat` and `Search` as primary navigation targets.
- Show `Knowledge Base` with `Files` in the left rail.
- Make the UI interactive with route-driven state.

## Confirmed Decisions
- Routing approach: hash-based routing (`HashRouter` behavior).
- Default route: `Chat`.
- Scope: renderer UI only.

## Information Architecture
- Left rail:
  - Primary: `Chat`, `Search`
  - Secondary group: `Knowledge Base`
    - Item: `Files`
- Main content:
  - `/chat`: assistant welcome + composer card
  - `/search`: search input + results list scaffold

## Interaction Model
- Clicking `Chat` navigates to `#/chat`.
- Clicking `Search` navigates to `#/search`.
- Initial load with empty hash redirects to `#/chat`.
- Left navigation highlights the active route.
- `Files` appears as selected under `Knowledge Base`.

## Visual Direction
- Light neutral background, subtle border and shadow, rounded corners.
- Clear nav hierarchy and obvious active states.
- Responsive fallback for small widths (left rail becomes top block).

## Testing Scope
- Renderer test validates:
  - default route resolves to chat content
  - hash route to search shows search content
  - left rail includes `Knowledge Base` and `Files`
