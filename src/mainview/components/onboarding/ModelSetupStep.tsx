import { useEffect, useState } from "react";
import type { AppConfig, ConfigService, EmbeddingProviderId, RerankerProviderId } from "../../../core/config/config.types";

export function ModelSetupStep({
  config,
  configService,
  onBack,
  onComplete,
}: {
  config: AppConfig;
  configService: ConfigService;
  onBack: () => void;
  onComplete: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [embeddingProvider, setEmbeddingProvider] = useState<EmbeddingProviderId>(config.embedding.provider);
  const [embeddingLocalModel, setEmbeddingLocalModel] = useState(config.embedding.local.model);
  const [embeddingLocalDimension, setEmbeddingLocalDimension] = useState(String(config.embedding.local.dimension));
  const [embeddingLocalHfEndpoint, setEmbeddingLocalHfEndpoint] = useState(config.embedding.local.hfEndpoint);
  const [embeddingCloudApiKey, setEmbeddingCloudApiKey] = useState(
    config.embedding.provider === "local" ? config.embedding.openai_dense.apiKey : config.embedding[config.embedding.provider].apiKey,
  );
  const [embeddingCloudModel, setEmbeddingCloudModel] = useState(
    config.embedding.provider === "local" ? config.embedding.openai_dense.model : config.embedding[config.embedding.provider].model,
  );
  const [embeddingCloudDimension, setEmbeddingCloudDimension] = useState(
    String(config.embedding.provider === "local" ? config.embedding.openai_dense.dimension : config.embedding[config.embedding.provider].dimension),
  );

  const [rerankerEnabled, setRerankerEnabled] = useState(config.reranker.enabled);
  const [rerankerProvider, setRerankerProvider] = useState<RerankerProviderId>(config.reranker.provider);
  const [rerankerLocalModel, setRerankerLocalModel] = useState(config.reranker.local.model);
  const [rerankerLocalTopN, setRerankerLocalTopN] = useState(String(config.reranker.local.topN));
  const [rerankerLocalHfEndpoint, setRerankerLocalHfEndpoint] = useState(config.reranker.local.hfEndpoint);
  const [rerankerCloudApiKey, setRerankerCloudApiKey] = useState(
    config.reranker.provider === "local" ? config.reranker.openai.apiKey : config.reranker[config.reranker.provider].apiKey,
  );
  const [rerankerCloudModel, setRerankerCloudModel] = useState(
    config.reranker.provider === "local" ? config.reranker.openai.model : config.reranker[config.reranker.provider].model,
  );
  const [rerankerCloudTopN, setRerankerCloudTopN] = useState(
    String(config.reranker.provider === "local" ? config.reranker.openai.topN : config.reranker[config.reranker.provider].topN),
  );

  useEffect(() => {
    if (embeddingProvider !== "local") {
      const next = config.embedding[embeddingProvider];
      setEmbeddingCloudApiKey(next.apiKey);
      setEmbeddingCloudModel(next.model);
      setEmbeddingCloudDimension(String(next.dimension));
    }
  }, [config.embedding, embeddingProvider]);

  useEffect(() => {
    if (rerankerProvider !== "local") {
      const next = config.reranker[rerankerProvider];
      setRerankerCloudApiKey(next.apiKey);
      setRerankerCloudModel(next.model);
      setRerankerCloudTopN(String(next.topN));
    }
  }, [config.reranker, rerankerProvider]);

  const continueToHome = async () => {
    setBusy(true);
    setError("");
    try {
      configService.updateConfig((source) => {
        const embedding =
          embeddingProvider === "local"
            ? {
                ...source.embedding,
                provider: "local" as const,
                local: {
                  ...source.embedding.local,
                  hfEndpoint: embeddingLocalHfEndpoint.trim() || source.embedding.local.hfEndpoint,
                  model: embeddingLocalModel.trim() || source.embedding.local.model,
                  dimension: Math.max(1, Number.parseInt(embeddingLocalDimension, 10) || source.embedding.local.dimension),
                },
              }
            : {
                ...source.embedding,
                provider: embeddingProvider,
                [embeddingProvider]: {
                  ...source.embedding[embeddingProvider],
                  apiKey: embeddingCloudApiKey,
                  model: embeddingCloudModel,
                  dimension: Math.max(1, Number.parseInt(embeddingCloudDimension, 10) || source.embedding[embeddingProvider].dimension),
                },
              };

        const reranker =
          rerankerProvider === "local"
            ? {
                ...source.reranker,
                enabled: rerankerEnabled,
                provider: "local" as const,
                local: {
                  ...source.reranker.local,
                  hfEndpoint: rerankerLocalHfEndpoint.trim() || source.reranker.local.hfEndpoint,
                  model: rerankerLocalModel.trim() || source.reranker.local.model,
                  topN: Math.max(1, Number.parseInt(rerankerLocalTopN, 10) || source.reranker.local.topN),
                },
              }
            : {
                ...source.reranker,
                enabled: rerankerEnabled,
                provider: rerankerProvider,
                [rerankerProvider]: {
                  ...source.reranker[rerankerProvider],
                  apiKey: rerankerCloudApiKey,
                  model: rerankerCloudModel,
                  topN: Math.max(1, Number.parseInt(rerankerCloudTopN, 10) || source.reranker[rerankerProvider].topN),
                },
              };

        return {
          ...source,
          embedding,
          reranker,
          onboarding: { completed: true },
        };
      });
      onComplete();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-slate-900">Step 2: Embedding & Reranker</h2>
      <p className="mt-1 text-sm text-slate-600">Defaults are prefilled. You can continue directly or adjust now.</p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <h3 className="font-semibold text-slate-900">Embedding</h3>
          <label className="mt-2 grid gap-1 text-sm text-slate-700">
            Provider
            <select
              data-testid="onboarding-embedding-provider"
              className="rounded-md border border-slate-300 px-2 py-1.5"
              value={embeddingProvider}
              onChange={(event) => setEmbeddingProvider(event.target.value as EmbeddingProviderId)}
            >
              <option value="local">local</option>
              <option value="openai_dense">openai_dense</option>
              <option value="qwen_dense">qwen_dense</option>
              <option value="qwen_sparse">qwen_sparse</option>
            </select>
          </label>
          {embeddingProvider === "local" ? (
            <>
              <label className="mt-2 grid gap-1 text-sm text-slate-700">
                Model
                <input className="rounded-md border border-slate-300 px-2 py-1.5" value={embeddingLocalModel} onChange={(e) => setEmbeddingLocalModel(e.target.value)} />
              </label>
              <label className="mt-2 grid gap-1 text-sm text-slate-700">
                Dimension
                <input className="rounded-md border border-slate-300 px-2 py-1.5" value={embeddingLocalDimension} onChange={(e) => setEmbeddingLocalDimension(e.target.value)} />
              </label>
              <label className="mt-2 grid gap-1 text-sm text-slate-700">
                HF Endpoint
                <input className="rounded-md border border-slate-300 px-2 py-1.5" value={embeddingLocalHfEndpoint} onChange={(e) => setEmbeddingLocalHfEndpoint(e.target.value)} />
              </label>
            </>
          ) : (
            <>
              <label className="mt-2 grid gap-1 text-sm text-slate-700">
                API Key
                <input className="rounded-md border border-slate-300 px-2 py-1.5" value={embeddingCloudApiKey} onChange={(e) => setEmbeddingCloudApiKey(e.target.value)} />
              </label>
              <label className="mt-2 grid gap-1 text-sm text-slate-700">
                Model
                <input className="rounded-md border border-slate-300 px-2 py-1.5" value={embeddingCloudModel} onChange={(e) => setEmbeddingCloudModel(e.target.value)} />
              </label>
              <label className="mt-2 grid gap-1 text-sm text-slate-700">
                Dimension
                <input className="rounded-md border border-slate-300 px-2 py-1.5" value={embeddingCloudDimension} onChange={(e) => setEmbeddingCloudDimension(e.target.value)} />
              </label>
            </>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <h3 className="font-semibold text-slate-900">Reranker</h3>
          <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={rerankerEnabled} onChange={(e) => setRerankerEnabled(e.target.checked)} />
            Enabled
          </label>
          <label className="mt-2 grid gap-1 text-sm text-slate-700">
            Provider
            <select
              className="rounded-md border border-slate-300 px-2 py-1.5"
              value={rerankerProvider}
              onChange={(event) => setRerankerProvider(event.target.value as RerankerProviderId)}
            >
              <option value="local">local</option>
              <option value="openai">openai</option>
              <option value="qwen">qwen</option>
            </select>
          </label>
          {rerankerProvider === "local" ? (
            <>
              <label className="mt-2 grid gap-1 text-sm text-slate-700">
                Model
                <input className="rounded-md border border-slate-300 px-2 py-1.5" value={rerankerLocalModel} onChange={(e) => setRerankerLocalModel(e.target.value)} />
              </label>
              <label className="mt-2 grid gap-1 text-sm text-slate-700">
                Top N
                <input className="rounded-md border border-slate-300 px-2 py-1.5" value={rerankerLocalTopN} onChange={(e) => setRerankerLocalTopN(e.target.value)} />
              </label>
              <label className="mt-2 grid gap-1 text-sm text-slate-700">
                HF Endpoint
                <input className="rounded-md border border-slate-300 px-2 py-1.5" value={rerankerLocalHfEndpoint} onChange={(e) => setRerankerLocalHfEndpoint(e.target.value)} />
              </label>
            </>
          ) : (
            <>
              <label className="mt-2 grid gap-1 text-sm text-slate-700">
                API Key
                <input className="rounded-md border border-slate-300 px-2 py-1.5" value={rerankerCloudApiKey} onChange={(e) => setRerankerCloudApiKey(e.target.value)} />
              </label>
              <label className="mt-2 grid gap-1 text-sm text-slate-700">
                Model
                <input className="rounded-md border border-slate-300 px-2 py-1.5" value={rerankerCloudModel} onChange={(e) => setRerankerCloudModel(e.target.value)} />
              </label>
              <label className="mt-2 grid gap-1 text-sm text-slate-700">
                Top N
                <input className="rounded-md border border-slate-300 px-2 py-1.5" value={rerankerCloudTopN} onChange={(e) => setRerankerCloudTopN(e.target.value)} />
              </label>
            </>
          )}
        </div>
      </div>

      {error ? <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className="mt-5 flex items-center justify-between">
        <button type="button" onClick={onBack} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">
          Back
        </button>
        <button
          data-testid="onboarding-complete"
          type="button"
          disabled={busy}
          onClick={() => void continueToHome()}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Saving..." : "Continue to Home"}
        </button>
      </div>
    </article>
  );
}
