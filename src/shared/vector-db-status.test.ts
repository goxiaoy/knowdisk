import { expect, test } from "bun:test";
import { FALLBACK_VECTOR_DB_STATUS } from "./vector-db-status";

test("provides a stable fallback vector db status", () => {
  expect(FALLBACK_VECTOR_DB_STATUS).toEqual({
    available: false,
    chunkCount: null,
    lastUpdatedAt: "",
    error: "",
  });
});
