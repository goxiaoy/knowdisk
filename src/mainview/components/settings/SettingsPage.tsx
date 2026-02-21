import { useMemo, useState } from "react";
import type { ConfigService } from "../../../core/config/config.types";
import { createHealthService, type AppHealth } from "../../../core/health/health.service";
import { defaultMainviewConfigService } from "../../services/config.service";

function healthClass(health: AppHealth) {
  if (health === "failed") return "health health-failed";
  if (health === "degraded") return "health health-degraded";
  return "health health-healthy";
}

export function SettingsPage({
  configService = defaultMainviewConfigService,
}: {
  configService?: ConfigService;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [mcpEnabled, setMcpEnabled] = useState(configService.getMcpEnabled());

  const health = useMemo(() => {
    const svc = createHealthService();
    return svc.getAppHealth();
  }, []);

  const toggleMcp = () => {
    const next = !mcpEnabled;
    configService.setMcpEnabled(next);
    setMcpEnabled(next);
  };

  return (
    <section className="settings-page">
      <h1>Settings</h1>
      <p className={healthClass(health)}>App health: {health}</p>
      <p>MCP Server: {mcpEnabled ? "Enabled" : "Disabled"}</p>
      <button type="button" onClick={toggleMcp}>
        {mcpEnabled ? "Turn MCP Off" : "Turn MCP On"}
      </button>
      <button type="button" onClick={() => setShowAdvanced((v) => !v)}>
        {showAdvanced ? "Hide Advanced" : "Show Advanced"}
      </button>
      {showAdvanced ? <div>Advanced Settings</div> : null}
    </section>
  );
}
