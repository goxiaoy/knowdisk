import { useEffect, useState } from "react";
import type { VectorCollectionInspect } from "../../../core/vector/vector.repository.types";
import { getVectorStatsFromBun } from "../../services/bun.rpc";

type LoadState = {
  loading: boolean;
  error: string;
  inspect: VectorCollectionInspect | null;
};

const INITIAL_STATE: LoadState = {
  loading: true,
  error: "",
  inspect: null,
};

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function VectorStatsCard({ pollMs = 3000 }: { pollMs?: number }) {
  const [state, setState] = useState<LoadState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const inspect = await getVectorStatsFromBun();
      if (cancelled) {
        return;
      }
      if (!inspect) {
        setState({ loading: false, error: "failed to load vector stats", inspect: null });
        return;
      }
      setState({ loading: false, error: "", inspect });
    };

    void load();
    const timer = setInterval(() => {
      void load();
    }, pollMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pollMs]);

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Vector Collection Stats</h2>
        {state.loading ? (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold uppercase text-slate-600">
            loading
          </span>
        ) : null}
      </div>
      {state.error ? (
        <p data-testid="vector-stats-error" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}
      {state.inspect ? (
        <div className="mt-3 space-y-4 text-sm text-slate-700">
          <dl className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="md:col-span-2">
              <dt className="text-slate-500">Collection Path</dt>
              <dd data-testid="vector-stats-path" className="break-all font-medium text-slate-900">
                {state.inspect.path}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Collection Name</dt>
              <dd className="font-medium text-slate-900">{state.inspect.schema.name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Document Count</dt>
              <dd data-testid="vector-stats-doc-count" className="font-medium text-slate-900">
                {state.inspect.stats.docCount}
              </dd>
            </div>
          </dl>

          <div>
            <h3 className="font-semibold text-slate-900">Vectors</h3>
            <pre className="mt-2 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
              {pretty(state.inspect.schema.vectors)}
            </pre>
          </div>

          <div>
            <h3 className="font-semibold text-slate-900">Fields</h3>
            <pre className="mt-2 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
              {pretty(state.inspect.schema.fields)}
            </pre>
          </div>

          <div>
            <h3 className="font-semibold text-slate-900">Stats</h3>
            <pre className="mt-2 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
              {pretty(state.inspect.stats)}
            </pre>
          </div>

          <div>
            <h3 className="font-semibold text-slate-900">Option / Options</h3>
            <pre className="mt-2 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
              {pretty({ option: state.inspect.option, options: state.inspect.options })}
            </pre>
          </div>
        </div>
      ) : null}
    </article>
  );
}
