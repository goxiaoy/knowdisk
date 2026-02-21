import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type ModelDownloadDeps = {
  fetchImpl?: typeof fetch;
};

export async function downloadModelFromHub(
  input: {
    hfEndpoint: string;
    model: string;
    targetRoot: string;
  },
  deps?: ModelDownloadDeps,
) {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const base = input.hfEndpoint.replace(/\/+$/, "");
  const model = input.model.trim();
  const encodedModel = model
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const url = `${base}/${encodedModel}/resolve/main/config.json`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`model download failed: ${response.status}`);
  }
  const body = await response.text();
  const target = join(input.targetRoot, model.replaceAll("/", "__"), "config.json");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body, "utf8");
  return { target };
}
