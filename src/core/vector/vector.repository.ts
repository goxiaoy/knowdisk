export type VectorRow = {
  chunkId: string;
  vector: number[];
  metadata: { sourcePath: string; chunkText?: string; updatedAt?: string };
};

export function createVectorRepository() {
  const rows: VectorRow[] = [];

  return {
    async upsert(input: VectorRow[]) {
      for (const row of input) {
        const index = rows.findIndex((item) => item.chunkId === row.chunkId);
        if (index >= 0) {
          rows[index] = row;
        } else {
          rows.push(row);
        }
      }
    },

    async search(query: number[], opts: { topK: number }) {
      const scored = rows.map((row) => ({
        ...row,
        score: dot(query, row.vector),
      }));

      scored.sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
      return scored.slice(0, opts.topK);
    },
  };
}

function dot(a: number[], b: number[]) {
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
}
