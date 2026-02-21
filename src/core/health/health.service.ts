export type ComponentHealth = "healthy" | "degraded" | "failed";
export type AppHealth = "healthy" | "degraded" | "failed";

export function createHealthService() {
  const states: Record<string, ComponentHealth> = {
    fs: "healthy",
    watch: "healthy",
    parser: "healthy",
    embedding: "healthy",
    zvec: "healthy",
    mcp: "healthy",
  };

  return {
    setComponent(name: string, state: ComponentHealth) {
      states[name] = state;
    },

    getAppHealth(): AppHealth {
      const values = Object.values(states);
      if (values.includes("failed")) {
        return "failed";
      }
      if (values.includes("degraded")) {
        return "degraded";
      }
      return "healthy";
    },
    getComponentHealth() {
      return { ...states };
    },
  };
}
