import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MarkdownViewer } from "../markdown-viewer";
import type { SearchResult } from "../../../shared/files";

export function SearchPanel({
  api,
  debounceMs = 250,
}: {
  api: {
    search: (input: { query: string; titleOnly?: boolean }) => Promise<SearchResponse>;
    getFileMarkdown: (nodeId: string) => Promise<
      | { ok: true; markdown: string; title: string | null }
      | { ok: false; error: string }
    >;
  };
  debounceMs?: number;
}) {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [previewMarkdown, setPreviewMarkdown] = useState("");
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const searchRequestRef = useRef(0);
  const previewRequestRef = useRef(0);

  useEffect(() => {
    const normalized = query.trim();
    const requestId = ++searchRequestRef.current;
    setIsSearching(true);
    setSearchError("");

    const runSearch = () => {
      void api.search({ query: normalized, titleOnly: false }).then((response) => {
        if (searchRequestRef.current !== requestId) {
          return;
        }
        setIsSearching(false);
        if (!response.ok) {
          setSearchError(response.error);
          setResults([]);
          setSelectedNodeId(null);
          setPreviewMarkdown("");
          setPreviewTitle(null);
          setPreviewError("");
          return;
        }
        setResults(response.finalResults);
        setSelectedNodeId(response.finalResults[0]?.nodeId ?? null);
      }).catch((error) => {
        if (searchRequestRef.current !== requestId) {
          return;
        }
        setIsSearching(false);
        setSearchError(error instanceof Error ? error.message : String(error));
        setResults([]);
        setSelectedNodeId(null);
        setPreviewMarkdown("");
        setPreviewTitle(null);
        setPreviewError("");
      });
    };

    if (debounceMs <= 0) {
      void runSearch();
      return;
    }

    const timer = globalThis.setTimeout(runSearch, debounceMs);

    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [api, debounceMs, query]);

  useEffect(() => {
    if (!selectedNodeId) {
      setPreviewMarkdown("");
      setPreviewTitle(null);
      setPreviewError("");
      setIsPreviewLoading(false);
      return;
    }

    const requestId = ++previewRequestRef.current;
    setIsPreviewLoading(true);
    setPreviewError("");

    void api.getFileMarkdown(selectedNodeId).then((response) => {
      if (previewRequestRef.current !== requestId) {
        return;
      }
      setIsPreviewLoading(false);
      if (!response.ok) {
        setPreviewMarkdown("");
        setPreviewTitle(null);
        setPreviewError(response.error);
        return;
      }
      setPreviewMarkdown(response.markdown);
      setPreviewTitle(response.title);
    }).catch((error) => {
      if (previewRequestRef.current !== requestId) {
        return;
      }
      setIsPreviewLoading(false);
      setPreviewMarkdown("");
      setPreviewTitle(null);
      setPreviewError(error instanceof Error ? error.message : String(error));
    });
  }, [api, selectedNodeId]);

  return (
    <section
      className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4 overflow-hidden"
      data-testid="search-panel"
    >
      <div className="shrink-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
        <label className="mb-2 block text-sm font-medium text-slate-600" htmlFor="search-query">
          Search knowledge
        </label>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 focus-within:border-slate-300">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            className="w-full border-0 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            id="search-query"
            placeholder="Search files, notes, and snippets"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {isSearching ? (
          <p className="mt-3 text-sm text-slate-500" data-testid="search-loading-state">
            Searching...
          </p>
        ) : null}
        {searchError ? (
          <p className="mt-3 text-sm text-rose-600" data-testid="search-error-state">
            {searchError}
          </p>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div
          className="min-h-0 overflow-auto rounded-2xl border border-slate-200 bg-white p-3"
          data-testid="search-results-pane"
        >
          {!isSearching && !searchError && results.length === 0 ? (
            <div className="text-sm text-slate-500" data-testid="search-empty-state">
              No content available.
            </div>
          ) : null}
          <div className="grid gap-3">
            {results.map((result) => (
              <button
                key={result.chunkId ?? `${result.nodeId}:${result.title ?? result.name ?? ""}`}
                type="button"
                data-testid="search-result-card"
                onClick={() => setSelectedNodeId(result.nodeId)}
                className={`rounded-2xl border px-4 py-3 text-left transition-colors duration-200 ${
                  selectedNodeId === result.nodeId
                    ? "border-sky-300 bg-sky-50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <h2 className="text-sm font-semibold text-slate-800">
                  {result.title?.trim() || result.name?.trim() || result.sourceRef?.trim() || result.nodeId}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {result.text?.trim() || "No preview snippet available."}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div
          className="min-h-0 overflow-auto rounded-2xl border border-slate-200 bg-white p-4"
          data-testid="search-preview"
        >
          {selectedNodeId === null ? (
            <div className="text-sm text-slate-500">Select a result to preview.</div>
          ) : null}
          {isPreviewLoading ? <div className="text-sm text-slate-500">Loading preview...</div> : null}
          {previewError ? (
            <div className="text-sm text-rose-600" data-testid="search-preview-error-state">
              {previewError}
            </div>
          ) : null}
          {!isPreviewLoading && !previewError && previewMarkdown ? (
            <div className="grid gap-3">
              <h2 className="text-sm font-semibold text-slate-800">{previewTitle || "Preview"}</h2>
              <MarkdownViewer markdown={previewMarkdown} />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
