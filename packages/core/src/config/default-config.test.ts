import { describe, expect, it } from "bun:test";
import { sep } from "node:path";
import { createDefaultCoreConfig } from "./index";

describe("createDefaultCoreConfig", () => {
  it("returns a package-scoped default config", () => {
    const config = createDefaultCoreConfig();

    expect(config.logger).toEqual({
      level: "info",
      name: "knowdisk",
    });
    expect(config.providers.huggingface?.endpoint).toBe("https://hf-mirror.com");
    expect(config.embedding.provider).toBe("local");
    expect(config.reranker.provider).toBe("local");
    expect(config.basePath.endsWith(`${sep}.knowdisk`)).toBe(true);
  });
});
