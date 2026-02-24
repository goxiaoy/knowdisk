import { describe, expect, it } from "bun:test";
import { act, create } from "react-test-renderer";
import { OnboardingPage } from "./OnboardingPage";
import type { AppConfig, ConfigService } from "../../../core/config/config.types";
import { getDefaultConfig } from "../../../core/config/config.service";

function makeInitialConfig(): AppConfig {
  const cfg = getDefaultConfig();
  return {
    ...cfg,
    onboarding: { completed: false },
    sources: [],
  };
}

function makeConfigService(): ConfigService {
  let config = makeInitialConfig();
  return {
    getConfig() {
      return config;
    },
    updateConfig(updater) {
      config = updater(config);
      return config;
    },
    subscribe() {
      return () => {};
    },
  };
}

describe("OnboardingPage", () => {
  it("disables next when no source is configured", () => {
    const renderer = create(
      <OnboardingPage configService={makeConfigService()} pickSourceDirectory={async () => null} />,
    );
    const root = renderer.root;
    const next = root.findByProps({ "data-testid": "onboarding-next" });
    expect(next.props.disabled).toBe(true);
  });

  it("enables completion after adding a source", async () => {
    const configService = makeConfigService();
    const renderer = create(
      <OnboardingPage configService={configService} pickSourceDirectory={async () => "/docs"} />,
    );
    const root = renderer.root;

    const add = root.findByProps({ "data-testid": "onboarding-add-source" });
    await act(async () => {
      await add.props.onClick();
    });

    const next = root.findByProps({ "data-testid": "onboarding-next" });
    expect(next.props.disabled).toBe(false);

    await act(async () => {
      next.props.onClick();
    });

    expect(configService.getConfig().onboarding.completed).toBe(true);
  });

  it("completes onboarding from source step", async () => {
    let finished = false;
    const configService = makeConfigService();
    const renderer = create(
      <OnboardingPage
        configService={configService}
        pickSourceDirectory={async () => "/docs"}
        onFinished={() => {
          finished = true;
        }}
      />,
    );
    const root = renderer.root;

    await act(async () => {
      await root.findByProps({ "data-testid": "onboarding-add-source" }).props.onClick();
    });
    await act(async () => {
      root.findByProps({ "data-testid": "onboarding-next" }).props.onClick();
    });

    expect(configService.getConfig().onboarding.completed).toBe(true);
    expect(finished).toBe(true);
  });
});
