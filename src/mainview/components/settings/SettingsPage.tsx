import { useMemo, useState } from "react";
import { createHealthService, type AppHealth } from "../../../core/health/health.service";

function healthClass(health: AppHealth) {
  if (health === "failed") return "health health-failed";
  if (health === "degraded") return "health health-degraded";
  return "health health-healthy";
}

export function SettingsPage() {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const health = useMemo(() => {
    const svc = createHealthService();
    return svc.getAppHealth();
  }, []);

  return (
    <section className="settings-page">
      <h1>Settings</h1>
      <p className={healthClass(health)}>App health: {health}</p>
      <button type="button" onClick={() => setShowAdvanced((v) => !v)}>
        {showAdvanced ? "Hide Advanced" : "Show Advanced"}
      </button>
      {showAdvanced ? <div>Advanced Settings</div> : null}
    </section>
  );
}
