import type { CoreConfig } from "@knowdisk/core";
import type { PythonWorkerPreferredDevice } from "../../shared/python-worker";
import type { PythonWorkerRuntimeStartupConfig } from "./runtime";

export type PythonWorkerCoreConfigSubset = {
  embedding: CoreConfig["embedding"];
  reranker: CoreConfig["reranker"];
  providers: Pick<CoreConfig["providers"], "huggingface">;
};

export function createPythonWorkerStartupConfig(input: {
  config: CoreConfig;
  preferredDevice: PythonWorkerPreferredDevice;
}): PythonWorkerRuntimeStartupConfig {
  if (input.config.embedding.provider !== "local" || !input.config.embedding.local) {
    throw new Error("python worker requires embedding.provider=local");
  }
  if (input.config.reranker.provider !== "local" || !input.config.reranker.local) {
    throw new Error("python worker requires reranker.provider=local");
  }

  return {
    basePath: input.config.basePath,
    embeddingModel: input.config.embedding.local.model,
    rerankerModel: input.config.reranker.local.model,
    preferredDevice: input.preferredDevice,
    huggingfaceEndpoint: input.config.providers.huggingface?.endpoint,
    coreConfig: createPythonWorkerCoreConfigSubset(input.config),
  };
}

export function createPythonWorkerCoreConfigSubset(
  config: CoreConfig
): PythonWorkerCoreConfigSubset {
  return {
    embedding: config.embedding,
    reranker: config.reranker,
    providers: {
      huggingface: config.providers.huggingface,
    },
  };
}
