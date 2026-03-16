import { describe, expect, test } from "bun:test";
import { isMissingRpcSendTransportError } from "./rpc-transport";

describe("isMissingRpcSendTransportError", () => {
  test("matches electrobun send transport errors", () => {
    expect(
      isMissingRpcSendTransportError(
        new Error(
          'This RPC instance cannot send messages because the transport did not provide one or more of these methods: "send"'
        )
      )
    ).toBe(true);
  });

  test("ignores unrelated errors", () => {
    expect(isMissingRpcSendTransportError(new Error("RPC request timed out."))).toBe(false);
    expect(isMissingRpcSendTransportError("transport did not provide registerHandler")).toBe(false);
  });
});
