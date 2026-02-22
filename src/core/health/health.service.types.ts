export type ComponentHealth = "healthy" | "degraded" | "failed";
export type AppHealth = "healthy" | "degraded" | "failed";

export type HealthService = {
  setComponent: (name: string, state: ComponentHealth) => void;
  getAppHealth: () => AppHealth;
  getComponentHealth: () => Record<string, ComponentHealth>;
};

