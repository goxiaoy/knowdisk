import { describe, expect, it } from "bun:test";
import { create } from "react-test-renderer";
import App from "./App";
import type { AppConfig, ConfigService } from "../core/config/config.types";
import { getDefaultConfig } from "../core/config/config.service";

function makeConfig(completed: boolean): AppConfig {
  const cfg = getDefaultConfig();
  return {
    ...cfg,
    onboarding: { completed },
    sources: completed ? [{ path: "/docs", enabled: true }] : [],
  };
}

function makeConfigService(completed: boolean): ConfigService {
  let config = makeConfig(completed);
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

describe("App", () => {
  it("shows onboarding when onboarding is not completed", () => {
    const renderer = create(<App configService={makeConfigService(false)} />);
    expect(renderer.root.findByProps({ children: "Welcome to Know Disk" })).toBeDefined();
  });

  it("shows app shell when onboarding is completed", () => {
    const renderer = create(<App configService={makeConfigService(true)} />);
    expect(renderer.root.findByProps({ children: "Home" })).toBeDefined();
    expect(renderer.root.findByProps({ children: "Settings" })).toBeDefined();
  });
});
