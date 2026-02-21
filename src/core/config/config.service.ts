export function getDefaultConfig() {
  return {
    ui: { mode: "safe" as const },
    indexing: { watch: { enabled: true } },
  };
}
