export type SkipReason = "UNSUPPORTED_TYPE";

export type ParseResult = {
  text: string;
  skipped?: SkipReason;
};

export type ParseChunk = {
  text: string;
  startOffset: number;
  endOffset: number;
  tokenEstimate: number;
  skipped?: SkipReason;
};

export type Parser = {
  id: "markdown" | "text" | "unsupported";
  parse: (input: string) => ParseResult;
  parseStream: (input: AsyncIterable<string>) => AsyncIterable<ParseChunk>;
};

export type ParserMeta = {
  ext?: string;
  mime?: string;
};
