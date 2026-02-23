import { IndexStatusCard } from "../indexing/IndexStatusCard";
import { VectorStatsCard } from "../home/VectorStatsCard";
import { ModelDownloadCard } from "./ModelDownloadCard";

export function StatusPage() {
  return (
    <section className="min-h-screen bg-[radial-gradient(circle_at_top,#e2e8f0_0%,#f8fafc_45%,#ecfeff_100%)] p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Status</h1>
          <p className="mt-1 text-sm text-slate-600">Indexing runtime and vector collection health.</p>
        </header>
        <div className="grid gap-6 xl:grid-cols-[1.15fr_1fr]">
          <IndexStatusCard />
          <div className="space-y-6">
            <ModelDownloadCard />
            <VectorStatsCard />
          </div>
        </div>
      </div>
    </section>
  );
}
