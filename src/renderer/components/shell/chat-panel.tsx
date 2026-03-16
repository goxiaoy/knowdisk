import { ArrowUp, CirclePlus, Plus, SlidersHorizontal } from "lucide-react";

export function ChatPanel() {
  return (
    <section
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-8"
      data-testid="chat-panel"
    >
      <h1 className="text-center font-heading text-4xl font-semibold tracking-tight text-slate-800 md:text-5xl">
        How can I help you today?
      </h1>

      <div className="w-full rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.08)] md:p-5">
        <div className="mb-4 flex items-center gap-2 text-sm text-slate-500">
          <button
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5 transition-colors duration-200 hover:border-slate-300 hover:text-slate-700"
            type="button"
          >
            <Plus className="h-4 w-4" />
            Add item
          </button>
        </div>

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
