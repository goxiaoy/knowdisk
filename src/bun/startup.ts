import type { Logger } from "pino";

export async function startBackgroundServices(input: {
  pythonWorkerRuntime: {
    start(): Promise<void>;
  };
  pythonWorkerAppRuntime: {
    start(): Promise<void>;
  };
  vfs: {
    start(): Promise<void>;
  };
  logger: Pick<Logger, "error">;
}): Promise<void> {
  try {
    await input.pythonWorkerRuntime.start();
    await input.pythonWorkerAppRuntime.start();
  } catch (error) {
    input.logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to start python worker services"
    );
  }

  try {
    await input.vfs.start();
  } catch (error) {
    input.logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to start vfs services"
    );
  }
}
