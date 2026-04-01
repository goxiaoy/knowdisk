import { describe, expect, mock, test } from "bun:test";
import { createRendererRpcSender } from "./renderer-rpc";

describe("createRendererRpcSender", () => {
  test("skips sends before the renderer webview is ready", () => {
    let domReadyHandler: (() => void) | undefined;
    const sendMessage = mock(() => {});
    const logger = { error: mock(() => {}) };
    const sender = createRendererRpcSender({
      webview: {
        on(name, handler) {
          expect(name).toBe("dom-ready");
          domReadyHandler = handler as () => void;
        },
      },
      logger,
    });

    sender.send(sendMessage, "failed to push update");

    expect(sendMessage).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(domReadyHandler).toBeDefined();
  });

  test("sends messages after the renderer webview reports dom-ready", () => {
    let domReadyHandler: (() => void) | undefined;
    const sendMessage = mock(() => {});
    const logger = { error: mock(() => {}) };
    const sender = createRendererRpcSender({
      webview: {
        on(_name, handler) {
          domReadyHandler = handler as () => void;
        },
      },
      logger,
    });

    domReadyHandler?.();
    sender.send(sendMessage, "failed to push update");

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("logs unexpected send failures after the renderer is ready", () => {
    let domReadyHandler: (() => void) | undefined;
    const logger = { error: mock(() => {}) };
    const sender = createRendererRpcSender({
      webview: {
        on(_name, handler) {
          domReadyHandler = handler as () => void;
        },
      },
      logger,
    });

    domReadyHandler?.();
    sender.send(() => {
      throw new Error("boom");
    }, "failed to push update");

    expect(logger.error).toHaveBeenCalledWith({ error: "boom" }, "failed to push update");
  });
});
