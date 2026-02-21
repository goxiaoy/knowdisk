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
  const [config, setConfig] = useState(configService.getConfig());
  const [mcpEnabled, setMcpEnabled] = useState(config.mcp.enabled);
  const [sources, setSources] = useState(config.sources);
  const [activity, setActivity] = useState("");
  const [subsystems, setSubsystems] = useState<Record<string, ComponentHealth>>({});
  const [embeddingMode, setEmbeddingMode] = useState(config.embedding.mode);
  const [embeddingProvider, setEmbeddingProvider] = useState(config.embedding.provider);
  const [embeddingModel, setEmbeddingModel] = useState(config.embedding.model);
  const [embeddingEndpoint, setEmbeddingEndpoint] = useState(config.embedding.endpoint);
  const [embeddingApiKey, setEmbeddingApiKey] = useState(config.embedding.apiKey);
  const [embeddingDimension, setEmbeddingDimension] = useState(String(config.embedding.dimension));
  const [rerankerMode, setRerankerMode] = useState(config.reranker.mode);
  const [rerankerModel, setRerankerModel] = useState(config.reranker.model);
  const [rerankerTopN, setRerankerTopN] = useState(String(config.reranker.topN));

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
    const updated = configService.setMcpEnabled(next);
    setConfig(updated);
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

  const saveEmbeddingConfig = () => {
    const next = configService.updateEmbedding({
      mode: embeddingMode,
      provider: embeddingProvider,
      model: embeddingModel,
      endpoint: embeddingEndpoint,
      apiKey: embeddingApiKey,
      dimension: Math.max(1, Number.parseInt(embeddingDimension, 10) || 384),
    });
    setConfig(next);
    setActivity("Embedding settings saved.");
  };

  const saveRerankerConfig = () => {
    const next = configService.updateReranker({
      mode: rerankerMode,
      model: rerankerModel,
      topN: Math.max(1, Number.parseInt(rerankerTopN, 10) || 5),
    });
    setConfig(next);
    setActivity("Reranker settings saved.");
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
      <h2>Embedding</h2>
      <p>
        Current: {config.embedding.mode} / {config.embedding.provider} / {config.embedding.model} / dim{" "}
        {config.embedding.dimension}
      </p>
      <label>
        Mode
        <select
          data-testid="embedding-mode"
          value={embeddingMode}
          onChange={(event) => setEmbeddingMode(event.target.value as "local" | "cloud")}
        >
          <option value="local">local</option>
          <option value="cloud">cloud</option>
        </select>
      </label>
      <label>
        Provider
        <select
          data-testid="embedding-provider"
          value={embeddingProvider}
          onChange={(event) =>
            setEmbeddingProvider(
              event.target.value as "local" | "qwen_dense" | "qwen_sparse" | "openai_dense",
            )
          }
        >
          <option value="local">local</option>
          <option value="qwen_dense">Qwen Dense</option>
          <option value="qwen_sparse">Qwen Sparse</option>
          <option value="openai_dense">OpenAI Dense</option>
        </select>
      </label>
      <label>
        Model
        <input
          data-testid="embedding-model"
          value={embeddingModel}
          onChange={(event) => setEmbeddingModel(event.target.value)}
        />
      </label>
      <label>
        Endpoint
        <input
          data-testid="embedding-endpoint"
          value={embeddingEndpoint}
          onChange={(event) => setEmbeddingEndpoint(event.target.value)}
        />
      </label>
      <label>
        API Key
        <input
          data-testid="embedding-api-key"
          value={embeddingApiKey}
          onChange={(event) => setEmbeddingApiKey(event.target.value)}
        />
      </label>
      <label>
        Dimension
        <input
          data-testid="embedding-dimension"
          value={embeddingDimension}
          onChange={(event) => setEmbeddingDimension(event.target.value)}
        />
      </label>
      <button data-testid="save-embedding" type="button" onClick={saveEmbeddingConfig}>
        Save Embedding
      </button>
      <h2>Reranker</h2>
      <p>
        Current: {config.reranker.mode} / {config.reranker.model} / topN {config.reranker.topN}
      </p>
      <label>
        Mode
        <select
          data-testid="reranker-mode"
          value={rerankerMode}
          onChange={(event) => setRerankerMode(event.target.value as "none" | "local")}
        >
          <option value="local">local</option>
          <option value="none">none</option>
        </select>
      </label>
      <label>
        Model
        <input
          data-testid="reranker-model"
          value={rerankerModel}
          onChange={(event) => setRerankerModel(event.target.value)}
        />
      </label>
      <label>
        TopN
        <input
          data-testid="reranker-topn"
          value={rerankerTopN}
          onChange={(event) => setRerankerTopN(event.target.value)}
        />
      </label>
      <button data-testid="save-reranker" type="button" onClick={saveRerankerConfig}>
        Save Reranker
      </button>
      <button type="button" onClick={() => setShowAdvanced((v) => !v)}>
        {showAdvanced ? "Hide Advanced" : "Show Advanced"}
      </button>
      {showAdvanced ? <div>Advanced Settings</div> : null}
    </section>
  );
}
