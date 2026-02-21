import { useEffect, useMemo, useState } from "react";
import type { ConfigService } from "../../../core/config/config.types";
import {
  createHealthService,
  type AppHealth,
  type ComponentHealth,
} from "../../../core/health/health.service";
import { defaultMainviewConfigService } from "../../services/config.service";
import { getHealthFromBun, pickSourceDirectoryFromBun } from "../../services/bun.rpc";

function healthClass(health: AppHealth) {
  if (health === "failed") return "health health-failed";
  if (health === "degraded") return "health health-degraded";
  return "health health-healthy";
}

export function SettingsPage({
  configService = defaultMainviewConfigService,
  pickSourceDirectory = pickSourceDirectoryFromBun,
}: {
  configService?: ConfigService;
  pickSourceDirectory?: () => Promise<string | null>;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [mcpEnabled, setMcpEnabled] = useState(configService.getMcpEnabled());
  const [sources, setSources] = useState(configService.getSources());
  const [activity, setActivity] = useState("");
  const [subsystems, setSubsystems] = useState<Record<string, ComponentHealth>>({});

  const { health, components } = useMemo(() => {
    const svc = createHealthService();
    return {
      health: svc.getAppHealth(),
      components: svc.getComponentHealth(),
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadHealth() {
      const fromBun = await getHealthFromBun();
      if (!cancelled && fromBun) {
        setSubsystems(fromBun);
      }
    }
    void loadHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleMcp = () => {
    const next = !mcpEnabled;
    configService.setMcpEnabled(next);
    setMcpEnabled(next);
  };

  const addSource = async () => {
    const path = await pickSourceDirectory();
    if (!path) return;
    setSources(configService.addSource(path));
    setActivity("Source added. Indexing started.");
  };

  const setSourceEnabled = (path: string, enabled: boolean) => {
    setSources(configService.updateSource(path, enabled));
  };

  const removeSource = (path: string) => {
    setSources(configService.removeSource(path));
  };

  const subsystemList = Object.entries(
    Object.keys(subsystems).length > 0 ? subsystems : components,
  ) as Array<[string, ComponentHealth]>;

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
      <button data-testid="add-source" type="button" onClick={() => void addSource()}>
        Add Source
      </button>
      {activity ? <p>{activity}</p> : null}
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
