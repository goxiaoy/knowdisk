import { useState } from "react";
import type { ConfigService } from "../../../core/config/config.types";
import { defaultMainviewConfigService } from "../../services/config.service";
import { pickSourceDirectoryFromBun } from "../../services/bun.rpc";
import { ModelSetupStep } from "./ModelSetupStep";
import { SourceSelectionStep } from "./SourceSelectionStep";

export function OnboardingPage({
  configService = defaultMainviewConfigService,
  pickSourceDirectory = pickSourceDirectoryFromBun,
  onFinished,
}: {
  configService?: ConfigService;
  pickSourceDirectory?: () => Promise<string | null>;
  onFinished?: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [config, setConfig] = useState(configService.getConfig());

  const setSources = (sources: Array<{ path: string; enabled: boolean }>) => {
    const next = configService.updateConfig((source) => ({
      ...source,
      sources,
    }));
    setConfig(next);
  };

  const finish = () => {
    const next = configService.getConfig();
    setConfig(next);
    onFinished?.();
  };

  return (
    <section className="min-h-screen bg-[radial-gradient(circle_at_top,#cffafe_0%,#ecfeff_38%,#f8fafc_100%)] p-4 md:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="rounded-2xl border border-cyan-200 bg-white/90 p-6 shadow-sm backdrop-blur">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Welcome to Know Disk</h1>
          <p className="mt-1 text-sm text-slate-600">Complete onboarding before entering Home.</p>
          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-cyan-700">Step {step} of 2</p>
        </header>

        {step === 1 ? (
          <SourceSelectionStep
            sources={config.sources}
            onSourcesChange={setSources}
            onNext={() => setStep(2)}
            pickSourceDirectory={pickSourceDirectory}
          />
        ) : (
          <ModelSetupStep
            config={config}
            configService={configService}
            onBack={() => setStep(1)}
            onComplete={finish}
          />
        )}
      </div>
    </section>
  );
}
