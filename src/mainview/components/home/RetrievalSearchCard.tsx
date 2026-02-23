import { type ReactNode, useEffect, useState } from "react";
import type { RetrievalDebugResult, RetrievalResult } from "../../../core/retrieval/retrieval.service.types";
import {
  listSourceFilesInBun,
  pickFilePathFromBun,
  retrieveSourceChunksInBun,
  searchRetrievalInBun,
} from "../../services/bun.rpc";

const DEFAULT_TOP_K = 10;

export function RetrievalSearchCard({
  search = searchRetrievalInBun,
  retrieveBySourcePath = retrieveSourceChunksInBun,
  listSourceFiles = listSourceFilesInBun,
  pickFilePath = pickFilePathFromBun,
  topK = DEFAULT_TOP_K,
}: {
  search?: (query: string, topK: number, titleOnly?: boolean) => Promise<RetrievalDebugResult | null>;
  retrieveBySourcePath?: (sourcePath: string) => Promise<RetrievalResult[] | null>;
  listSourceFiles?: () => Promise<string[] | null>;
  pickFilePath?: () => Promise<string | null>;
  topK?: number;
}) {
  const [query, setQuery] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [loading, setLoading] = useState(false);
  const [retrieving, setRetrieving] = useState(false);
  const [pickingFile, setPickingFile] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<RetrievalResult[]>([]);
  const [debugResults, setDebugResults] = useState<RetrievalDebugResult | null>(null);
  const [sourceFileOptions, setSourceFileOptions] = useState<string[]>([]);
  const [titleOnly, setTitleOnly] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const rows = await listSourceFiles();
      if (!active || !rows) {
        return;
      }
      setSourceFileOptions(rows);
    })();
    return () => {
      active = false;
    };
  }, [listSourceFiles]);

  const runSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed || loading) {
      return;
    }
    setLoading(true);
    setError("");
    const debug = await search(trimmed, topK, titleOnly);
    if (!debug) {
      setError("Search request failed.");
      setResults([]);
      setDebugResults(null);
      setLoading(false);
      return;
    }
    setResults(debug.reranked);
    setDebugResults(debug);
    setLoading(false);
  };

  const runRetrieveBySourcePath = async () => {
    const trimmed = sourcePath.trim();
    if (!trimmed || retrieving) {
      return;
    }
    setRetrieving(true);
    setError("");
    const rows = await retrieveBySourcePath(trimmed);
    if (!rows) {
      setError("Retrieve source chunks request failed.");
      setResults([]);
      setDebugResults(null);
      setRetrieving(false);
      return;
    }
    setResults(rows);
    setDebugResults(null);
    setRetrieving(false);
  };

  const pickSourceFilePath = async () => {
    if (pickingFile) {
      return;
    }
    setPickingFile(true);
    const path = await pickFilePath();
    if (path) {
      setSourcePath(path);
    }
    setPickingFile(false);
  };

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Retrieval Search</h2>
      <p className="mt-1 text-sm text-slate-600">Search indexed chunks directly from RetrievalService (topK={topK}).</p>

      <div className="mt-3 flex gap-2">
        <input
          data-testid="retrieval-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type query..."
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
        />
        <button
          data-testid="retrieval-search"
          type="button"
          disabled={loading || query.trim().length === 0}
          onClick={() => void runSearch()}
          className="rounded-lg bg-cyan-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </div>
      <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600">
        <input
          data-testid="retrieval-title-only"
          type="checkbox"
          checked={titleOnly}
          onChange={(event) => setTitleOnly(event.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-cyan-700 focus:ring-cyan-200"
        />
        Title only (search by file title/path in vector + FTS)
      </label>

      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">or retrieve all chunks by file path</p>
      <div className="mt-2 flex gap-2">
        <input
          data-testid="retrieval-source-path"
          value={sourcePath}
          onChange={(event) => setSourcePath(event.target.value)}
          placeholder="/absolute/path/to/file.md"
          list="retrieval-source-file-options"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
        />
        <datalist id="retrieval-source-file-options">
          {sourceFileOptions.map((filePath) => (
            <option key={filePath} value={filePath} />
          ))}
        </datalist>
        <button
          data-testid="retrieval-pick-file"
          type="button"
          disabled={pickingFile}
          onClick={() => void pickSourceFilePath()}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pickingFile ? "Picking..." : "Pick File"}
        </button>
        <button
          data-testid="retrieval-by-source"
          type="button"
          disabled={retrieving || sourcePath.trim().length === 0}
          onClick={() => void runRetrieveBySourcePath()}
          className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {retrieving ? "Retrieving..." : "Retrieve Chunks"}
        </button>
      </div>

      {error ? (
        <p data-testid="retrieval-error" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="mt-4 space-y-3">
        {debugResults ? (
          <div className="space-y-4 rounded-xl border border-cyan-100 bg-cyan-50/40 p-3">
            <DebugSection title={`Rerank Results (${debugResults.reranked.length})`} rows={debugResults.reranked} />
            <DebugSection title={`FTS Results (${debugResults.fts.length})`}>
              {debugResults.fts.length === 0 ? (
                <p className="text-xs text-slate-500">No results.</p>
              ) : (
                <div className="space-y-2">
                  {debugResults.fts.map((row) => (
                    <div key={`${row.kind}-${row.chunkId}-${row.sourcePath}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <p className="break-all text-xs font-semibold text-slate-900">{row.sourcePath}</p>
                      <p className="mt-1 text-[11px] text-cyan-700">kind: {row.kind}, score: {row.score.toFixed(3)}</p>
                      <p className="mt-1 whitespace-pre-wrap text-xs text-slate-700">{row.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </DebugSection>
            <DebugSection title={`Vector Results (${debugResults.vector.length})`} rows={debugResults.vector} />
          </div>
        ) : null}
        {!debugResults && results.length === 0 ? (
          <p data-testid="retrieval-empty" className="text-sm text-slate-500">No results.</p>
        ) : !debugResults ? (
          results.map((row) => (
            <div key={`${row.chunkId}-${row.sourcePath}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="break-all text-sm font-semibold text-slate-900">{row.sourcePath}</p>
              <p className="mt-1 text-xs font-medium text-cyan-700">score: {row.score.toFixed(3)}</p>
              <p className="mt-1 text-xs text-slate-500">
                offset: {row.startOffset ?? "-"} - {row.endOffset ?? "-"}, tokens: {row.tokenEstimate ?? "-"}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{row.chunkText}</p>
            </div>
          ))
        ) : null}
      </div>
    </article>
  );
}

function DebugSection({
  title,
  rows,
  children,
}: {
  title: string;
  rows?: RetrievalResult[];
  children?: ReactNode;
}) {
  return (
    <section>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</p>
      {children ? children : null}
      {rows ? (
        rows.length === 0 ? (
          <p className="text-xs text-slate-500">No results.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <div key={`${row.chunkId}-${row.sourcePath}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <p className="break-all text-xs font-semibold text-slate-900">{row.sourcePath}</p>
                <p className="mt-1 text-[11px] text-cyan-700">score: {row.score.toFixed(3)}</p>
                <p className="mt-1 whitespace-pre-wrap text-xs text-slate-700">{row.chunkText}</p>
              </div>
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}
