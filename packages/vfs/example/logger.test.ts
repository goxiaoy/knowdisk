import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { createExampleLogger } from "./logger";

describe("vfs example logger", () => {
  test("writes friendly lines without pid or hostname", () => {
    const output = new PassThrough();
    let text = "";
    output.on("data", (chunk: Buffer | string) => {
      text += chunk.toString();
    });

    const logger = createExampleLogger({ stream: output });
    logger.info({ mountId: "m1", sourceRef: "a.txt" }, "syncer watch started");

    expect(text).toContain("[INFO]");
    expect(text).toContain("knowdisk.vfs.example");
    expect(text).toContain("syncer watch started");
    expect(text).toContain("mountId=m1");
    expect(text).toContain("sourceRef=a.txt");
    expect(text).not.toContain("\"pid\"");
    expect(text).not.toContain("\"hostname\"");
    expect(text).not.toContain("{");
  });
});
