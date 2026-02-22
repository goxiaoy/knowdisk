import { IndexStatusCard } from "../indexing/IndexStatusCard";
import { VectorStatsCard } from "./VectorStatsCard";

export function HomePage() {
  return (
    <section className="min-h-screen bg-[radial-gradient(circle_at_top,#e2e8f0_0%,#f8fafc_45%,#ecfeff_100%)] p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Know Disk Home</h1>
          <p className="mt-1 text-sm text-slate-600">Vector collection inspection and indexing runtime status</p>
        </header>

        <div className="grid gap-6 xl:grid-cols-2">
          <VectorStatsCard />
          <IndexStatusCard />
        </div>
      </div>
    </section>
  );
}
