import { expect, test } from "bun:test";
import { ELECTROBUN_RPC_MAX_REQUEST_TIME } from "./rpc-config";

test("electrobun rpc timeout stays disabled for long-running native dialogs", () => {
  expect(ELECTROBUN_RPC_MAX_REQUEST_TIME).toBe(Infinity);
});
