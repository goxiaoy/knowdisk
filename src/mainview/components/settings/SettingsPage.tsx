import { useEffect, useMemo, useState } from "react";
import type { ConfigService } from "../../../core/config/config.types";
import { createHealthService } from "../../../core/health/health.service";
import type { AppHealth, ComponentHealth } from "../../../core/health/health.service.types";
import { defaultMainviewConfigService } from "../../services/config.service";
import {
  addSourceInBun,
  getHealthFromBun,
  pickSourceDirectoryFromBun,
  removeSourceInBun,
  updateSourceInBun,
} from "../../services/bun.rpc";

function healthClass(health: AppHealth) {
  if (health === "failed") return "bg-red-100 text-red-700";
  if (health === "degraded") return "bg-amber-100 text-amber-700";
  return "bg-emerald-100 text-emerald-700";
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
  const [mcpPort, setMcpPort] = useState(String(config.mcp.port));
  const [sources, setSources] = useState(config.sources);
  const [activity, setActivity] = useState("");
  const [subsystems, setSubsystems] = useState<Record<string, ComponentHealth>>({});

  const [embeddingProvider, setEmbeddingProvider] = useState(config.embedding.provider);
  const [embeddingLocalHfEndpoint, setEmbeddingLocalHfEndpoint] = useState(config.embedding.local.hfEndpoint);
  const [embeddingLocalCacheDir, setEmbeddingLocalCacheDir] = useState(config.embedding.local.cacheDir);
  const [embeddingLocalModel, setEmbeddingLocalModel] = useState(config.embedding.local.model);
  const [embeddingLocalDimension, setEmbeddingLocalDimension] = useState(String(config.embedding.local.dimension));
  const initialEmbeddingCloud =
    config.embedding.provider === "local"
      ? config.embedding.openai_dense
      : config.embedding[config.embedding.provider];
  const [embeddingCloudApiKey, setEmbeddingCloudApiKey] = useState(initialEmbeddingCloud.apiKey);
  const [embeddingCloudModel, setEmbeddingCloudModel] = useState(initialEmbeddingCloud.model);
  const [embeddingCloudDimension, setEmbeddingCloudDimension] = useState(String(initialEmbeddingCloud.dimension));

  const [rerankerEnabled, setRerankerEnabled] = useState(config.reranker.enabled);
  const [rerankerProvider, setRerankerProvider] = useState(config.reranker.provider);
  const [rerankerLocalHfEndpoint, setRerankerLocalHfEndpoint] = useState(config.reranker.local.hfEndpoint);
  const [rerankerLocalCacheDir, setRerankerLocalCacheDir] = useState(config.reranker.local.cacheDir);
  const [rerankerLocalModel, setRerankerLocalModel] = useState(config.reranker.local.model);
  const [rerankerLocalTopN, setRerankerLocalTopN] = useState(String(config.reranker.local.topN));
  const initialRerankerCloud =
    config.reranker.provider === "local" ? config.reranker.openai : config.reranker[config.reranker.provider];
  const [rerankerCloudApiKey, setRerankerCloudApiKey] = useState(initialRerankerCloud.apiKey);
  const [rerankerCloudModel, setRerankerCloudModel] = useState(initialRerankerCloud.model);
  const [rerankerCloudTopN, setRerankerCloudTopN] = useState(String(initialRerankerCloud.topN));

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
      mcp: {
        enabled: next,
        port: source.mcp.port,
      },
    }));
    setConfig(updated);
    setMcpEnabled(next);
    setMcpPort(String(updated.mcp.port));
  };

  const saveMcpConfig = () => {
    const parsedPort = Number.parseInt(mcpPort, 10);
    const nextPort = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
      ? parsedPort
      : config.mcp.port;
    const updated = configService.updateConfig((source) => ({
      ...source,
      mcp: {
        enabled: mcpEnabled,
        port: nextPort,
      },
    }));
    setConfig(updated);
    setMcpEnabled(updated.mcp.enabled);
    setMcpPort(String(updated.mcp.port));
    setActivity("MCP settings saved. Restart app to apply new endpoint port.");
  };

  const addSource = async () => {
    const path = await pickSourceDirectory();
    console.info("[settings:addSource] pick result", { path });
    if (!path) {
      console.info("[settings:addSource] cancelled by user");
      return;
    }
    const remoteSources = await addSourceInBun(path);
    console.info("[settings:addSource] remote response", {
      path,
      sourceCount: remoteSources?.length ?? null,
    });
    const next = configService.updateConfig((source) => {
      if (remoteSources) {
        console.info("[settings:addSource] using remote sources", {
          path,
          sourceCount: remoteSources.length,
        });
        return { ...source, sources: remoteSources };
      }
      if (source.sources.some((item) => item.path === path)) {
        console.info("[settings:addSource] source already exists", { path });
        return source;
      }
      console.info("[settings:addSource] using local fallback add", { path });
      return { ...source, sources: [...source.sources, { path, enabled: true }] };
    });
    setConfig(next);
    setSources(next.sources);
    setActivity("Source added. Indexing started.");
    console.info("[settings:addSource] completed", {
      path,
      sourceCount: next.sources.length,
    });
  };

  const setSourceEnabled = (path: string, enabled: boolean) => {
    void updateSourceInBun(path, enabled).then((remoteSources) => {
      const next = configService.updateConfig((source) => ({
        ...source,
        sources:
          remoteSources ??
          source.sources.map((item) => (item.path === path ? { ...item, enabled } : item)),
      }));
      setSources(next.sources);
    });
  };

  const removeSource = (path: string) => {
    void removeSourceInBun(path).then((remoteSources) => {
      const next = configService.updateConfig((source) => ({
        ...source,
        sources: remoteSources ?? source.sources.filter((item) => item.path !== path),
      }));
      setSources(next.sources);
    });
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
                cacheDir: embeddingLocalCacheDir.trim() || source.embedding.local.cacheDir,
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
                cacheDir: rerankerLocalCacheDir.trim() || source.reranker.local.cacheDir,
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
    <section className="settings-page min-h-screen bg-[radial-gradient(circle_at_top,#eff6ff_0%,#f8fafc_45%,#eef2ff_100%)] p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Settings</h1>
              <p className="mt-1 text-sm text-slate-600">Know Disk runtime and retrieval configuration</p>
            </div>
            <p
              className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-sm font-medium capitalize ${healthClass(health)}`}
            >
              App health: {health}
            </p>
          </div>
          {activity ? (
            <p className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
              {activity}
            </p>
          ) : null}
        </header>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_1fr]">
          <div className="space-y-6">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">System Health</h2>
              <p className="mt-1 text-sm text-slate-500">All subsystem status</p>
              <ul className="mt-4 space-y-2">
                {subsystemList.map(([name, state]) => (
                  <li
                    key={name}
                    className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                  >
                    <span className="text-sm font-medium text-slate-700">{name}</span>
                    <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold uppercase text-slate-600">
                      {state}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Sources</h2>
                  <p className="mt-1 text-sm text-slate-500">Indexed folders and files</p>
                </div>
                <button
                  data-testid="add-source"
                  type="button"
                  onClick={() => void addSource()}
                  className="rounded-lg bg-cyan-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-cyan-800"
                >
                  Add Source
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {sources.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500">
                    No sources configured.
                  </p>
                ) : (
                  sources.map((source) => (
                    <div
                      key={source.path}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"
                    >
                      <div className="break-all text-sm font-medium text-slate-800">{source.path}</div>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                          <input
                            data-testid={`toggle-${source.path}`}
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-cyan-700 focus:ring-cyan-500"
                            checked={source.enabled}
                            onChange={(event) => setSourceEnabled(source.path, event.target.checked)}
                          />
                          Enabled
                        </label>
                        <button
                          data-testid={`remove-${source.path}`}
                          type="button"
                          onClick={() => removeSource(source.path)}
                          className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                {showAdvanced ? "Hide Advanced" : "Show Advanced"}
              </button>
              {showAdvanced ? (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  Advanced Settings
                </div>
              ) : null}
            </article>
          </div>

          <div className="space-y-6">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">MCP</h2>
              <p className="mt-1 text-sm text-slate-500">Tool server integration</p>
              <p className="mt-3 text-sm font-medium text-slate-800">
                MCP Server: {mcpEnabled ? "Enabled" : "Disabled"}
              </p>
              <label className="mt-3 grid gap-1 text-sm text-slate-700">
                MCP Port
                <input
                  data-testid="mcp-port"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                  value={mcpPort}
                  onChange={(event) => setMcpPort(event.target.value)}
                />
              </label>
              <button
                type="button"
                onClick={toggleMcp}
                className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
              >
                {mcpEnabled ? "Turn MCP Off" : "Turn MCP On"}
              </button>
              <button
                data-testid="save-mcp"
                type="button"
                onClick={saveMcpConfig}
                className="mt-3 rounded-lg bg-cyan-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-cyan-800"
              >
                Save MCP
              </button>
            </article>

            {showAdvanced ? (
              <>
                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Embedding</h2>
              <p className="mt-1 text-sm text-slate-500">Current provider: {config.embedding.provider}</p>

              <div className="mt-4 grid gap-4">
                <label className="grid gap-1 text-sm text-slate-700">
                  Provider
                  <select
                    data-testid="embedding-provider"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
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
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-1 text-sm text-slate-700 md:col-span-2">
                      HF Endpoint
                      <input
                        data-testid="embedding-local-hf-endpoint"
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                        value={embeddingLocalHfEndpoint}
                        onChange={(event) => setEmbeddingLocalHfEndpoint(event.target.value)}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700 md:col-span-2">
                      Cache Dir
                      <input
                        data-testid="embedding-local-cache-dir"
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                        value={embeddingLocalCacheDir}
                        onChange={(event) => setEmbeddingLocalCacheDir(event.target.value)}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700">
                      Model
                      <input
                        data-testid="embedding-local-model"
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                        value={embeddingLocalModel}
                        onChange={(event) => setEmbeddingLocalModel(event.target.value)}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700">
                      Dimension
                      <input
                        data-testid="embedding-local-dimension"
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                        value={embeddingLocalDimension}
                        onChange={(event) => setEmbeddingLocalDimension(event.target.value)}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-1 text-sm text-slate-700 md:col-span-2">
                      API Key
                      <input
                        data-testid="embedding-cloud-api-key"
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                        value={embeddingCloudApiKey}
                        onChange={(event) => setEmbeddingCloudApiKey(event.target.value)}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700">
                      Model
                      <input
                        data-testid="embedding-cloud-model"
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                        value={embeddingCloudModel}
                        onChange={(event) => setEmbeddingCloudModel(event.target.value)}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700">
                      Dimension
                      <input
                        data-testid="embedding-cloud-dimension"
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                        value={embeddingCloudDimension}
                        onChange={(event) => setEmbeddingCloudDimension(event.target.value)}
                      />
                    </label>
                  </div>
                )}
              </div>

              <button
                data-testid="save-embedding"
                type="button"
                onClick={saveEmbeddingConfig}
                className="mt-4 rounded-lg bg-cyan-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-cyan-800"
              >
                Save Embedding
              </button>
                </article>

                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Reranker</h2>
              <p className="mt-1 text-sm text-slate-500">Current provider: {config.reranker.provider}</p>

              <div className="mt-4 grid gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    data-testid="reranker-enabled"
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-cyan-700 focus:ring-cyan-500"
                    checked={rerankerEnabled}
                    onChange={(event) => setRerankerEnabled(event.target.checked)}
                  />
                  Enabled
                </label>
                <label className="grid gap-1 text-sm text-slate-700">
                  Provider
                  <select
                    data-testid="reranker-provider"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                    value={rerankerProvider}
                    onChange={(event) => setRerankerProvider(event.target.value as "local" | "qwen" | "openai")}
                  >
                    <option value="local">local</option>
                    <option value="qwen">qwen</option>
                    <option value="openai">openai</option>
                  </select>
                </label>

                {rerankerProvider === "local" ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-1 text-sm text-slate-700 md:col-span-2">
                      HF Endpoint
                      <input
                        data-testid="reranker-local-hf-endpoint"
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                        value={rerankerLocalHfEndpoint}
                        onChange={(event) => setRerankerLocalHfEndpoint(event.target.value)}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700 md:col-span-2">
                      Cache Dir
                      <input
                        data-testid="reranker-local-cache-dir"
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                        value={rerankerLocalCacheDir}
                        onChange={(event) => setRerankerLocalCacheDir(event.target.value)}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700">
                      Model
                      <input
                        data-testid="reranker-local-model"
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                        value={rerankerLocalModel}
                        onChange={(event) => setRerankerLocalModel(event.target.value)}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700">
                      TopN
                      <input
                        data-testid="reranker-local-topn"
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                        value={rerankerLocalTopN}
                        onChange={(event) => setRerankerLocalTopN(event.target.value)}
                      />
                    </label>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-1 text-sm text-slate-700 md:col-span-2">
                      API Key
                      <input
                        data-testid="reranker-cloud-api-key"
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                        value={rerankerCloudApiKey}
                        onChange={(event) => setRerankerCloudApiKey(event.target.value)}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700">
                      Model
                      <input
                        data-testid="reranker-cloud-model"
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                        value={rerankerCloudModel}
                        onChange={(event) => setRerankerCloudModel(event.target.value)}
                      />
                    </label>
                    <label className="grid gap-1 text-sm text-slate-700">
                      TopN
                      <input
                        data-testid="reranker-cloud-topn"
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                        value={rerankerCloudTopN}
                        onChange={(event) => setRerankerCloudTopN(event.target.value)}
                      />
                    </label>
                  </div>
                )}
              </div>

              <button
                data-testid="save-reranker"
                type="button"
                onClick={saveRerankerConfig}
                className="mt-4 rounded-lg bg-cyan-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-cyan-800"
              >
                Save Reranker
              </button>
                </article>
              </>
            ) : (
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm text-slate-600">
                  Embedding and reranker settings are in Advanced mode.
                </p>
              </article>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
