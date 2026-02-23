import type { AppHealth, ComponentHealth, HealthService } from "./health.service.types";

export function createHealthService(): HealthService {
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
