# Python Zvec Vector Store Design

## Goal

Replace the current placeholder Python vector backend with `alibaba/zvec` for both persistence and retrieval, while keeping the Bun/UI-facing worker protocol stable.

## Scope

- Add a real `zvec` backend under `python/worker/vector/`
- Keep `VectorRepository` as the domain-facing abstraction
- Replace current placeholder `search` with vector search
- Keep current search result shape compatible with the existing worker protocol

Out of scope:

- UI changes
- Rank fusion or hybrid retrieval
- Broader search product redesign

## Architecture

### Repository Layer

`python/worker/vector/repository.py` stays as the only entry point used by `IndexService`.

It continues to expose:

- `upsert_chunks`
- `delete_by_node_id`
- `count_chunks`
- `search`

### Backend Layer

Add `python/worker/vector/zvec_backend.py` to isolate direct `zvec` API usage.

The backend is responsible for:

- opening the collection
- writing chunk rows
- deleting rows by `node_id`
- counting rows
- nearest-neighbor search by query embedding

## Data Model

Each stored vector row will carry:

- `chunk_id`
- `node_id`
- `mount_id`
- `source_ref`
- `name`
- `title`
- `text`
- `embedding`

`embedding` is the vector field. The rest are metadata fields returned in search results and used for deletes.

## Search Flow

`IndexService.search(query)` changes from placeholder text matching to vector retrieval:

1. normalize query
2. get the local embedding runtime from `ModelService`
3. embed the query text
4. call `VectorRepository.search(query_embedding, limit=...)`
5. map backend hits to the existing result shape

This keeps embedding generation in `IndexService`, not the repository, so indexing and retrieval use the same runtime path.

## Error Handling

- Backend initialization failures should surface as normal Python worker errors
- Empty or blank queries should still return `[]`
- Search should fail loudly if the vector backend is unavailable rather than silently falling back to the placeholder path

## Testing

### Python Unit

- `zvec_backend` upsert/delete/count/search
- repository row conversion and result mapping

### Python Integration

- index a local node, then retrieve it via vector search
- delete a node and verify count/search changes

### Bun Integration

- keep the real worker integration green with the new search path

## Notes

- This change should not alter the worker protocol surface area
- Search result shape should stay compatible with existing Bun assertions
