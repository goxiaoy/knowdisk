import { useState } from "react";
import { HomePage } from "./components/home/HomePage";
import { IndexRunBadge } from "./components/indexing/IndexRunBadge";
import { OnboardingPage } from "./components/onboarding/OnboardingPage";
import { SettingsPage } from "./components/settings/SettingsPage";
import { StatusPage } from "./components/status/StatusPage";
import { defaultMainviewConfigService } from "./services/config.service";
import type { ConfigService } from "../core/config/config.types";

function App({ configService = defaultMainviewConfigService }: { configService?: ConfigService }) {
  const [config, setConfig] = useState(() => configService.getConfig());
  const [tab, setTab] = useState<"home" | "status" | "settings">("home");

  if (!config.onboarding.completed) {
    return (
      <OnboardingPage
        configService={configService}
        onFinished={() => {
          setConfig(configService.getConfig());
          setTab("home");
        }}
      />
    );
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <nav className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-8">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTab("home")}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                tab === "home" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => setTab("status")}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                tab === "status"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Status
            </button>
            <button
              type="button"
              onClick={() => setTab("settings")}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                tab === "settings"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Settings
            </button>
          </div>
          <IndexRunBadge onClick={() => setTab("status")} />
        </div>
      </nav>
      {tab === "home" ? <HomePage /> : tab === "status" ? <StatusPage /> : <SettingsPage />}
    </main>
  );
}

export default App;
