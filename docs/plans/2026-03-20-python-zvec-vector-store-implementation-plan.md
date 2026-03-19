# Python Zvec Vector Store Implementation Plan

1. Add `zvec` dependency to the Python workspace and confirm the import path/API expected in this repo.
2. Implement `python/worker/vector/zvec_backend.py` with typed methods for open/upsert/delete/count/search.
3. Refactor `python/worker/vector/repository.py` to delegate persistence and retrieval to the backend.
4. Update `python/worker/index/service.py` so `search(query)` embeds the query and calls repository vector search instead of placeholder text matching.
5. Add or update Python unit tests for backend behavior and repository mapping.
6. Update Python integration tests so indexed content is retrieved through real vector search.
7. Run targeted Bun integration tests to confirm the worker path remains compatible.
