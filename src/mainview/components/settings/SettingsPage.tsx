import { useEffect, useMemo, useState } from "react";
import type { ConfigService } from "../../../core/config/config.types";
import {
  createHealthService,
  type AppHealth,
  type ComponentHealth,
} from "../../../core/health/health.service";
import { defaultMainviewConfigService } from "../../services/config.service";
import {
  addSourceInBun,
  getHealthFromBun,
  pickSourceDirectoryFromBun,
  removeSourceInBun,
  updateSourceInBun,
} from "../../services/bun.rpc";

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

  const [embeddingProvider, setEmbeddingProvider] = useState(config.embedding.provider);
  const [embeddingLocalHfEndpoint, setEmbeddingLocalHfEndpoint] = useState(config.embedding.local.hfEndpoint);
  const [embeddingLocalCacheDir, setEmbeddingLocalCacheDir] = useState(config.embedding.local.cacheDir);
  const [embeddingLocalModel, setEmbeddingLocalModel] = useState(config.embedding.local.model);
  const [embeddingLocalDimension, setEmbeddingLocalDimension] = useState(String(config.embedding.local.dimension));
  const [embeddingCloudApiKey, setEmbeddingCloudApiKey] = useState("");
  const [embeddingCloudModel, setEmbeddingCloudModel] = useState("");
  const [embeddingCloudDimension, setEmbeddingCloudDimension] = useState("1024");

  const [rerankerEnabled, setRerankerEnabled] = useState(config.reranker.enabled);
  const [rerankerProvider, setRerankerProvider] = useState(config.reranker.provider);
  const [rerankerLocalHfEndpoint, setRerankerLocalHfEndpoint] = useState(config.reranker.local.hfEndpoint);
  const [rerankerLocalCacheDir, setRerankerLocalCacheDir] = useState(config.reranker.local.cacheDir);
  const [rerankerLocalModel, setRerankerLocalModel] = useState(config.reranker.local.model);
  const [rerankerLocalTopN, setRerankerLocalTopN] = useState(String(config.reranker.local.topN));
  const [rerankerCloudApiKey, setRerankerCloudApiKey] = useState("");
  const [rerankerCloudModel, setRerankerCloudModel] = useState("");
  const [rerankerCloudTopN, setRerankerCloudTopN] = useState("5");

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

  useEffect(() => {
    const next = config.embedding[embeddingProvider];
    if (embeddingProvider !== "local") {
      setEmbeddingCloudApiKey(next.apiKey);
      setEmbeddingCloudModel(next.model);
      setEmbeddingCloudDimension(String(next.dimension));
    }
  }, [config.embedding, embeddingProvider]);

  useEffect(() => {
    const next = config.reranker[rerankerProvider];
    if (rerankerProvider !== "local") {
      setRerankerCloudApiKey(next.apiKey);
      setRerankerCloudModel(next.model);
      setRerankerCloudTopN(String(next.topN));
    }
  }, [config.reranker, rerankerProvider]);

  const toggleMcp = () => {
    const next = !mcpEnabled;
    const updated = configService.updateConfig((source) => ({
      ...source,
      mcp: { enabled: next },
    }));
    setConfig(updated);
    setMcpEnabled(next);
  };

  const addSource = async () => {
    const path = await pickSourceDirectory();
    if (!path) return;
    const next = configService.updateConfig((source) => {
      if (source.sources.some((item) => item.path === path)) {
        return source;
      }
      return {
        ...source,
        sources: [...source.sources, { path, enabled: true }],
      };
    });
    setSources(next.sources);
    void addSourceInBun(path);
    setActivity("Source added. Indexing started.");
  };

  const setSourceEnabled = (path: string, enabled: boolean) => {
    const next = configService.updateConfig((source) => ({
      ...source,
      sources: source.sources.map((item) =>
        item.path === path ? { ...item, enabled } : item,
      ),
    }));
    setSources(next.sources);
    void updateSourceInBun(path, enabled);
  };

  const removeSource = (path: string) => {
    const next = configService.updateConfig((source) => ({
      ...source,
      sources: source.sources.filter((item) => item.path !== path),
    }));
    setSources(next.sources);
    void removeSourceInBun(path);
  };

  const saveEmbeddingConfig = () => {
    const next =
      embeddingProvider === "local"
        ? configService.updateConfig((source) => ({
            ...source,
            embedding: {
              ...source.embedding,
              provider: "local",
              local: {
                hfEndpoint: embeddingLocalHfEndpoint.trim() || "https://hf-mirror.com",
                cacheDir: embeddingLocalCacheDir.trim() || "build/cache/embedding/local",
                model: embeddingLocalModel.trim() || "Xenova/all-MiniLM-L6-v2",
                dimension: Math.max(1, Number.parseInt(embeddingLocalDimension, 10) || 384),
              },
            },
          }))
        : configService.updateConfig((source) => ({
            ...source,
            embedding: {
              ...source.embedding,
              provider: embeddingProvider,
              [embeddingProvider]: {
                ...source.embedding[embeddingProvider],
                apiKey: embeddingCloudApiKey,
                model: embeddingCloudModel,
                dimension: Math.max(1, Number.parseInt(embeddingCloudDimension, 10) || 1024),
              },
            },
          }));
    setConfig(next);
    setActivity("Embedding settings saved.");
  };

  const saveRerankerConfig = () => {
    const next =
      rerankerProvider === "local"
        ? configService.updateConfig((source) => ({
            ...source,
            reranker: {
              ...source.reranker,
              enabled: rerankerEnabled,
              provider: "local",
              local: {
                hfEndpoint: rerankerLocalHfEndpoint.trim() || "https://hf-mirror.com",
                cacheDir: rerankerLocalCacheDir.trim() || "build/cache/reranker/local",
                model: rerankerLocalModel.trim() || "BAAI/bge-reranker-base",
                topN: Math.max(1, Number.parseInt(rerankerLocalTopN, 10) || 5),
              },
            },
          }))
        : configService.updateConfig((source) => ({
            ...source,
            reranker: {
              ...source.reranker,
              enabled: rerankerEnabled,
              provider: rerankerProvider,
              [rerankerProvider]: {
                ...source.reranker[rerankerProvider],
                apiKey: rerankerCloudApiKey,
                model: rerankerCloudModel,
                topN: Math.max(1, Number.parseInt(rerankerCloudTopN, 10) || 5),
              },
            },
          }));
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
      <p>Current provider: {config.embedding.provider}</p>
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

      {embeddingProvider === "local" ? (
        <>
          <label>
            HF Endpoint
            <input
              data-testid="embedding-local-hf-endpoint"
              value={embeddingLocalHfEndpoint}
              onChange={(event) => setEmbeddingLocalHfEndpoint(event.target.value)}
            />
          </label>
          <label>
            Cache Dir
            <input
              data-testid="embedding-local-cache-dir"
              value={embeddingLocalCacheDir}
              onChange={(event) => setEmbeddingLocalCacheDir(event.target.value)}
            />
          </label>
          <label>
            Model
            <input
              data-testid="embedding-local-model"
              value={embeddingLocalModel}
              onChange={(event) => setEmbeddingLocalModel(event.target.value)}
            />
          </label>
          <label>
            Dimension
            <input
              data-testid="embedding-local-dimension"
              value={embeddingLocalDimension}
              onChange={(event) => setEmbeddingLocalDimension(event.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            API Key
            <input
              data-testid="embedding-cloud-api-key"
              value={embeddingCloudApiKey}
              onChange={(event) => setEmbeddingCloudApiKey(event.target.value)}
            />
          </label>
          <label>
            Model
            <input
              data-testid="embedding-cloud-model"
              value={embeddingCloudModel}
              onChange={(event) => setEmbeddingCloudModel(event.target.value)}
            />
          </label>
          <label>
            Dimension
            <input
              data-testid="embedding-cloud-dimension"
              value={embeddingCloudDimension}
              onChange={(event) => setEmbeddingCloudDimension(event.target.value)}
            />
          </label>
        </>
      )}

      <button data-testid="save-embedding" type="button" onClick={saveEmbeddingConfig}>
        Save Embedding
      </button>

      <h2>Reranker</h2>
      <p>Current provider: {config.reranker.provider}</p>
      <label>
        Enabled
        <input
          data-testid="reranker-enabled"
          type="checkbox"
          checked={rerankerEnabled}
          onChange={(event) => setRerankerEnabled(event.target.checked)}
        />
      </label>
      <label>
        Provider
        <select
          data-testid="reranker-provider"
          value={rerankerProvider}
          onChange={(event) => setRerankerProvider(event.target.value as "local" | "qwen" | "openai")}
        >
          <option value="local">local</option>
          <option value="qwen">qwen</option>
          <option value="openai">openai</option>
        </select>
      </label>

      {rerankerProvider === "local" ? (
        <>
          <label>
            HF Endpoint
            <input
              data-testid="reranker-local-hf-endpoint"
              value={rerankerLocalHfEndpoint}
              onChange={(event) => setRerankerLocalHfEndpoint(event.target.value)}
            />
          </label>
          <label>
            Cache Dir
            <input
              data-testid="reranker-local-cache-dir"
              value={rerankerLocalCacheDir}
              onChange={(event) => setRerankerLocalCacheDir(event.target.value)}
            />
          </label>
          <label>
            Model
            <input
              data-testid="reranker-local-model"
              value={rerankerLocalModel}
              onChange={(event) => setRerankerLocalModel(event.target.value)}
            />
          </label>
          <label>
            TopN
            <input
              data-testid="reranker-local-topn"
              value={rerankerLocalTopN}
              onChange={(event) => setRerankerLocalTopN(event.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            API Key
            <input
              data-testid="reranker-cloud-api-key"
              value={rerankerCloudApiKey}
              onChange={(event) => setRerankerCloudApiKey(event.target.value)}
            />
          </label>
          <label>
            Model
            <input
              data-testid="reranker-cloud-model"
              value={rerankerCloudModel}
              onChange={(event) => setRerankerCloudModel(event.target.value)}
            />
          </label>
          <label>
            TopN
            <input
              data-testid="reranker-cloud-topn"
              value={rerankerCloudTopN}
              onChange={(event) => setRerankerCloudTopN(event.target.value)}
            />
          </label>
        </>
      )}

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
