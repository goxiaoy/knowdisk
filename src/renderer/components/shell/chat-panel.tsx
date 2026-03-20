import { ArrowUp, CirclePlus, Plus, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "../../../shared/files";
import type { ShellSearchApi } from "./types";

function getItemLabel(item: SearchResult): string {
  return item.title?.trim() || item.name?.trim() || item.sourceRef?.trim() || item.nodeId;
}

export function ChatPanel({
  searchApi,
  debounceMs = 250,
}: {
  searchApi: ShellSearchApi;
  debounceMs?: number;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [pickerResults, setPickerResults] = useState<SearchResult[]>([]);
  const [selectedItem, setSelectedItem] = useState<SearchResult | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!pickerOpen) {
      return;
    }

    const requestId = ++requestRef.current;
    setPickerLoading(true);
    setPickerError("");

    const runSearch = () => {
      void searchApi.search({ query: pickerQuery.trim(), titleOnly: false }).then((response) => {
        if (requestRef.current !== requestId) {
          return;
        }
        setPickerLoading(false);
        if (!response.ok) {
          setPickerError(response.error);
          setPickerResults([]);
          return;
        }
        setPickerResults(response.finalResults);
      }).catch((error) => {
        if (requestRef.current !== requestId) {
          return;
        }
        setPickerLoading(false);
        setPickerError(error instanceof Error ? error.message : String(error));
        setPickerResults([]);
      });
    };

    if (debounceMs <= 0) {
      runSearch();
      return;
    }

    const timer = globalThis.setTimeout(runSearch, debounceMs);
    return () => globalThis.clearTimeout(timer);
  }, [debounceMs, pickerOpen, pickerQuery, searchApi]);

  return (
    <section
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-8"
      data-testid="chat-panel"
    >
      <h1 className="text-center font-heading text-4xl font-semibold tracking-tight text-slate-800 md:text-5xl">
        How can I help you today?
      </h1>

      <div className="w-full rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.08)] md:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-500" data-testid="chat-selected-row">
          {selectedItem ? (
            <div
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm text-slate-700"
              data-testid="chat-selected-chip"
            >
              <span>{getItemLabel(selectedItem)}</span>
              <button
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-500 transition-colors duration-200 hover:bg-slate-200 hover:text-slate-800"
                data-testid="chat-selected-chip-remove"
                onClick={() => setSelectedItem(null)}
                type="button"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}

          <button
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5 transition-colors duration-200 hover:border-slate-300 hover:text-slate-700"
            data-testid="chat-add-item-button"
            onClick={() => setPickerOpen((value) => !value)}
            type="button"
          >
            <Plus className="h-4 w-4" />
            Add item
          </button>
        </div>

        {pickerOpen ? (
          <div
            className="mb-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-3"
            data-testid="chat-item-picker"
          >
            <input
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none placeholder:text-slate-400"
              data-testid="chat-item-picker-input"
              placeholder="Search files to attach"
              type="text"
              value={pickerQuery}
              onChange={(event) => setPickerQuery(event.target.value)}
            />
            {pickerLoading ? <p className="mt-2 text-sm text-slate-500">Searching...</p> : null}
            {pickerError ? <p className="mt-2 text-sm text-rose-600">{pickerError}</p> : null}
            <div className="mt-3 grid gap-2">
              {pickerResults.map((item) => {
                const selected = selectedItem?.nodeId === item.nodeId;
                return (
                  <button
                    key={item.nodeId}
                    className={`rounded-2xl border px-3 py-2 text-left text-sm transition-colors duration-200 ${
                      selected
                        ? "border-sky-300 bg-sky-50 text-sky-900"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                    data-testid="chat-picker-result"
                    onClick={() => {
                      setSelectedItem(item);
                      setPickerOpen(false);
                    }}
                    type="button"
                  >
                    <div className="font-medium">{getItemLabel(item)}</div>
                    <div className="mt-1 text-slate-500">{item.text?.trim() || item.sourceRef?.trim() || ""}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <p className="mb-10 text-lg text-slate-400">Ask now, @ to select an item</p>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors duration-200 hover:border-slate-300 hover:text-slate-700"
              type="button"
            >
              <CirclePlus className="h-5 w-5" />
            </button>
            <button
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors duration-200 hover:border-slate-300 hover:text-slate-800"
              type="button"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Fast
            </button>
          </div>

          <button
            className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-slate-900 text-white shadow-lg transition-colors duration-200 hover:bg-slate-700"
            type="button"
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        </div>
      </div>
    </section>
  );
}
