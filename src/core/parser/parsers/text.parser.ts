import type { Parser } from "../parser.types";

const STREAM_CHUNK_SIZE = 4000;
const CHARS_PER_TOKEN = 4;

export const textParser: Parser = {
  id: "text",
  parse(input: string) {
    return { text: input };
  },
  async *parseStream(input: AsyncIterable<string>) {
    let buffer = "";
    let emitted = 0;
    for await (const chunk of input) {
      buffer += chunk;
      while (buffer.length >= STREAM_CHUNK_SIZE) {
        const text = buffer.slice(0, STREAM_CHUNK_SIZE);
        yield {
          text,
          startOffset: emitted,
          endOffset: emitted + text.length,
          tokenEstimate: estimateTokens(text),
        };
        emitted += text.length;
        buffer = buffer.slice(STREAM_CHUNK_SIZE);
      }
    }
    if (buffer.length > 0) {
      const text = buffer;
      yield {
        text,
        startOffset: emitted,
        endOffset: emitted + text.length,
        tokenEstimate: estimateTokens(text),
      };
    }
  },
};

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}
