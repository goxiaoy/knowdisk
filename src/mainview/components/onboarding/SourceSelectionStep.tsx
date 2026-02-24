import { useState } from "react";
import type { SourceConfig } from "../../../core/config/config.types";
import { addSourceInBun, pickSourceDirectoryFromBun, removeSourceInBun } from "../../services/bun.rpc";

export function SourceSelectionStep({
  sources,
  onSourcesChange,
  onNext,
  nextLabel = "Next",
  pickSourceDirectory = pickSourceDirectoryFromBun,
}: {
  sources: SourceConfig[];
  onSourcesChange: (sources: SourceConfig[]) => void;
  onNext: () => void;
  nextLabel?: string;
  pickSourceDirectory?: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const addSource = async () => {
    setError("");
    setBusy(true);
    try {
      const path = await pickSourceDirectory();
      if (!path) {
        return;
      }
      const remoteSources = await addSourceInBun(path);
      if (remoteSources) {
        onSourcesChange(remoteSources);
        return;
      }
      if (sources.some((item) => item.path === path)) {
        return;
      }
      onSourcesChange([...sources, { path, enabled: true }]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeSource = async (path: string) => {
    setError("");
    setBusy(true);
    try {
      const remoteSources = await removeSourceInBun(path);
      if (remoteSources) {
        onSourcesChange(remoteSources);
        return;
      }
      onSourcesChange(sources.filter((item) => item.path !== path));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-semibold text-slate-900">Step 1: Choose Sources</h2>
      <p className="mt-1 text-sm text-slate-600">Select at least one local folder or file to index.</p>

      <button
        data-testid="onboarding-add-source"
        type="button"
        disabled={busy}
        onClick={() => void addSource()}
        className="mt-4 rounded-lg bg-cyan-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Working..." : "Add Source"}
      </button>

      <div className="mt-4 space-y-2">
        {sources.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500">
            No sources selected yet.
          </p>
        ) : (
          sources.map((source) => (
            <div key={source.path} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="break-all text-sm text-slate-800">{source.path}</p>
              <button
                type="button"
                onClick={() => void removeSource(source.path)}
                className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700"
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>

      {error ? (
        <p data-testid="onboarding-source-error" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex justify-end">
        <button
          data-testid="onboarding-next"
          type="button"
          disabled={sources.length === 0 || busy}
          onClick={onNext}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {nextLabel}
        </button>
      </div>
    </article>
  );
}
