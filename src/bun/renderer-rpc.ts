type RendererWebview = {
  on(name: "dom-ready", handler: (event: unknown) => void): void;
};

type Logger = {
  error(fields: { error: string }, message: string): void;
};

export function createRendererRpcSender(input: {
  webview: RendererWebview;
  logger: Logger;
}) {
  let rendererReady = false;

  input.webview.on("dom-ready", () => {
    rendererReady = true;
  });

  return {
    send(sendMessage: () => void, errorMessage: string): void {
      if (!rendererReady) {
        return;
      }

      try {
        sendMessage();
      } catch (error) {
        input.logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
          },
          errorMessage
        );
      }
    },
  };
}
