import { useMemo, useState } from "react";
import type { ConfigService } from "../../../core/config/config.types";
import {
  createHealthService,
  type AppHealth,
  type ComponentHealth,
} from "../../../core/health/health.service";
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
  const [sources, setSources] = useState(configService.getSources());
  const [sourceInput, setSourceInput] = useState("");

  const { health, components } = useMemo(() => {
    const svc = createHealthService();
    return {
      health: svc.getAppHealth(),
      components: svc.getComponentHealth(),
    };
  }, []);

  const toggleMcp = () => {
    const next = !mcpEnabled;
    configService.setMcpEnabled(next);
    setMcpEnabled(next);
  };

  const addSource = () => {
    const path = sourceInput.trim();
    if (!path) return;
    setSources(configService.addSource(path));
    setSourceInput("");
  };

  const setSourceEnabled = (path: string, enabled: boolean) => {
    setSources(configService.updateSource(path, enabled));
  };

  const removeSource = (path: string) => {
    setSources(configService.removeSource(path));
  };

  const subsystemList = Object.entries(components) as Array<[string, ComponentHealth]>;

  return (
    <section className="settings-page">
      <h1>Settings</h1>
      <p className={healthClass(health)}>App health: {health}</p>
      <ul>
        {subsystemList.map(([name, state]) => (
          <li key={name}>
            {name}: {state}
          </li>
        ))}
      </ul>
      <p>MCP Server: {mcpEnabled ? "Enabled" : "Disabled"}</p>
      <button type="button" onClick={toggleMcp}>
        {mcpEnabled ? "Turn MCP Off" : "Turn MCP On"}
      </button>
      <h2>Sources</h2>
      <div>
        <input
          data-testid="source-input"
          type="text"
          value={sourceInput}
          onChange={(event) => setSourceInput(event.target.value)}
        />
        <button data-testid="add-source" type="button" onClick={addSource}>
          Add Source
        </button>
      </div>
      <ul>
        {sources.map((source) => (
          <li key={source.path}>
            <span>{source.path}</span>
            <label>
              Enabled
              <input
                data-testid={`toggle-${source.path}`}
                type="checkbox"
                checked={source.enabled}
                onChange={(event) => setSourceEnabled(source.path, event.target.checked)}
              />
            </label>
            <button
              data-testid={`remove-${source.path}`}
              type="button"
              onClick={() => removeSource(source.path)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => setShowAdvanced((v) => !v)}>
        {showAdvanced ? "Hide Advanced" : "Show Advanced"}
      </button>
      {showAdvanced ? <div>Advanced Settings</div> : null}
    </section>
  );
}
