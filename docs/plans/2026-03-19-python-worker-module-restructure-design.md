# Python Worker Module Restructure Design

## Goal

Reorganize the Python worker into clear domain folders and replace the current broad `dict[str, Any]` interfaces with strongly typed domain objects and protocol payload shapes.

This is a structure and typing refactor. Runtime behavior, wire protocol semantics, and existing feature scope should remain unchanged.

## Current Problems

The current `python/worker` layout is flat:

- model files
- parser files
- indexing files
- vector files
- protocol/server files
- runtime/bootstrap files

all live in the same directory.

This creates two concrete problems:

1. Module boundaries are weak.
   Parser, model, index, protocol, and runtime code import each other through a single flat namespace, which makes it harder to understand ownership and dependency direction.

2. Type boundaries are weak.
   Many module interfaces use `dict[str, Any]`, `Mapping[str, Any]`, and broad `Any` values for:
   - protocol frames
   - worker start params
   - parser node/mount/chunk shapes
   - vector rows
   - status snapshots
   - service outputs

The result is that JSON-like dictionaries leak into business logic instead of being confined to the protocol boundary.

## Recommended Approach

Use a domain-oriented package structure and push strong typing down to every module boundary.

Recommended top-level layout under `python/worker`:

- `worker/model/`
- `worker/parser/`
- `worker/index/`
- `worker/vector/`
- `worker/protocol/`
- `worker/runtime/`

The only place that should still deal in untyped JSON-like dictionaries is the final encode/decode boundary around stdio frames.

## Package Structure

### `worker/model/`

Owns local model lifecycle:

- artifact selection
- artifact download
- artifact cache management
- local runtime loading
- model service orchestration
- model domain types

Target files:

- `types.py`
- `artifacts.py`
- `download.py`
- `artifact_manager.py`
- `runtime_loader.py`
- `service.py`

### `worker/parser/`

Owns parsing and parser input/output types:

- simple parser
- docling adapter
- parser routing
- node/mount/chunk types

Target files:

- `types.py`
- `simple.py`
- `docling_adapter.py`
- `service.py`

### `worker/index/`

Owns indexing orchestration:

- queue execution
- index service
- typed indexing requests/results

Target files:

- `types.py`
- `queue.py`
- `service.py`

### `worker/vector/`

Owns vector storage integration:

- vector row type
- backend protocol
- repository wrapper

Target files:

- `types.py`
- `repository.py`

### `worker/protocol/`

Owns stdio protocol shapes and request dispatch:

- request/response/event frame types
- worker request payload types
- frame encode/decode helpers
- request dispatch server

Target files:

- `types.py`
- `frames.py`
- `server.py`

### `worker/runtime/`

Owns process bootstrap and shared worker runtime facilities:

- status stores
- structured stderr logging
- worker bootstrap graph

Target files:

- `types.py`
- `status.py`
- `logging.py`
- `bootstrap.py`

### `worker/__main__.py`

Should become a thin entrypoint only:

- call bootstrap
- run stdio loop
- exit cleanly

## Strong Typing Strategy

Use different typing tools for different layers.

### Business Objects: `dataclass`

Use `@dataclass(slots=True)` for Python-internal domain objects that move between modules:

- `ModelRuntimeConfig`
- `LocalNode`
- `LocalMount`
- `ParsedChunk`
- `VectorChunkRow`
- `WorkerLogRecord`
- `IndexNodeRequest`

These are not just arbitrary JSON payloads. They are domain objects with stable fields and clear ownership.

### JSON Payload Shapes: `TypedDict`

Use `TypedDict` for protocol payloads and snapshots that are serialized as JSON:

- request frames
- response frames
- event frames
- model status payload
- index status payload
- vector status payload

This keeps JSON shapes explicit without forcing all protocol traffic through dataclass serialization helpers.

### Injectable Boundaries: `Protocol`

Use `Protocol` for behavior-oriented seams:

- embedding runtime loader
- reranker runtime loader
- download fetch client
- vector backend
- event sink

This keeps current test injection patterns intact while strengthening signatures.

### Limited `Any`

`Any` should remain only at unavoidable foreign-library boundaries, for example:

- raw `json.loads()` results before validation
- `transformers` and `sentence-transformers` runtime objects where upstream typing is incomplete

Those values should be narrowed immediately and must not propagate through service interfaces.

## Migration Strategy

Do not do a blind move-first refactor. The migration should happen in this order:

1. Introduce domain and protocol types in new `types.py` modules.
2. Convert high-traffic interfaces away from `dict[str, Any]`.
3. Move modules into domain folders once import boundaries are clearer.
4. Thin out `worker/__main__.py` last.

This keeps failures attributable. If files move before interfaces are typed, import churn and behavioral bugs become hard to separate.

During rollout, keeping thin compatibility wrappers at the old flat import paths is acceptable as a temporary migration aid, as long as the real implementations move into the domain packages and new runtime code imports those domain packages directly.

## Behavior Constraints

This refactor must not change:

- worker stdio transport semantics
- worker start/shutdown semantics
- current parser routing behavior
- current model download/verify behavior
- current incremental indexing behavior
- current status payload meanings

The purpose is better structure and stronger types, not new functionality.

## Testing Strategy

Testing should follow the refactor in layers.

### Python

- update module-specific tests as files move
- add targeted type-boundary tests where dictionaries are replaced by typed objects
- keep existing protocol, parser, model, index, and integration coverage green

### Bun

- keep protocol/runtime integration tests green
- avoid protocol semantic changes so Bun-side tests require only import/path-neutral updates

### Verification Focus

The refactor is successful when:

- Python tests still pass
- Bun worker tests still pass
- `bun run dev` still launches the worker
- `dict[str, Any]` is removed from internal Python service interfaces

## Risks

Primary risk is coupling hidden inside the current flat module graph.

Specific risks:

- circular imports after moving types into shared modules
- tests depending on old import paths
- overusing `TypedDict` where `dataclass` is more appropriate
- leaving protocol dictionaries in business logic by accident

The mitigation is to refactor from boundaries inward and verify after each slice.
