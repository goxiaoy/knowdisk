import process from "node:process";
import type { Writable } from "node:stream";
import { createExampleLogger } from "../../vfs/example/logger";

type CreateParserExampleLoggerInput = {
  stream?: Writable;
  name?: string;
};

export function createParserExampleLogger(
  input?: CreateParserExampleLoggerInput,
) {
  const stream = input?.stream ?? process.stdout;
  const name = input?.name ?? "knowdisk.parser.example";
  const logger = createExampleLogger({ stream, name });

  return {
    stream,
    logger,
    writeLine(line: string) {
      stream.write(`${line}\n`);
    },
  };
}
