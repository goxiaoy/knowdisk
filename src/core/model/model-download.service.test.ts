import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadModelFromHub } from "./model-download.service";

test("downloads model config using hf endpoint", async () => {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-model-"));
  const result = await downloadModelFromHub(
    {
      hfEndpoint: "https://hf-mirror.com",
      model: "BAAI/bge-small-en-v1.5",
      targetRoot: dir,
    },
    {
      fetchImpl: async (url) => {
        expect(String(url)).toContain(
          "https://hf-mirror.com/BAAI/bge-small-en-v1.5/resolve/main/config.json",
        );
        return new Response('{"architectures":["MockModel"]}', { status: 200 });
      },
    },
  );

  const saved = readFileSync(result.target, "utf8");
  expect(saved).toContain("MockModel");
  rmSync(dir, { recursive: true, force: true });
});
