import { useState } from "react";
import { IndexStatusCard } from "../indexing/IndexStatusCard";
import { forceResyncInBun } from "../../services/bun.rpc";
import { VectorStatsCard } from "./VectorStatsCard";

export function HomePage({
  forceResync = forceResyncInBun,
}: {
  forceResync?: () => Promise<{ ok: boolean; error?: string } | null>;
}) {
  const [resyncing, setResyncing] = useState(false);
  const [activity, setActivity] = useState("");

  const onForceResync = async () => {
    setResyncing(true);
    setActivity("");
    const result = await forceResync();
    if (!result) {
      setActivity("Force resync request failed.");
      setResyncing(false);
      return;
    }
    setActivity(result.ok ? "Force resync started." : `Force resync failed: ${result.error ?? "unknown error"}`);
    setResyncing(false);
  };

  return (
    <section className="min-h-screen bg-[radial-gradient(circle_at_top,#e2e8f0_0%,#f8fafc_45%,#ecfeff_100%)] p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Know Disk Home</h1>
              <p className="mt-1 text-sm text-slate-600">Vector collection inspection and indexing runtime status</p>
            </div>
            <button
              data-testid="home-force-resync"
              type="button"
              disabled={resyncing}
              onClick={() => void onForceResync()}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resyncing ? "Force Resync..." : "Force Resync"}
            </button>
          </div>
          {activity ? (
            <p className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">
              {activity}
            </p>
          ) : null}
        </header>

        <div className="grid gap-6 xl:grid-cols-2">
          <VectorStatsCard />
          <IndexStatusCard />
        </div>
      </div>
    </section>
  );
}
