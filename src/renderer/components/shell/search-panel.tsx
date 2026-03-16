import { Search } from "lucide-react";

export function SearchPanel() {
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4" data-testid="search-panel">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
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
          />
        </div>
      </div>

      <div className="grid gap-3">
        {[
          "Recent indexing status",
          "Product requirements in /docs",
          "Latest architecture decisions",
        ].map((title) => (
          <article
            key={title}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 transition-colors duration-200 hover:border-slate-300"
          >
            <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">Preview result content for the search experience.</p>
          </article>
        ))}
      </div>
    </section>
  );
}
