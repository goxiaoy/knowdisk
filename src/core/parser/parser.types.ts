export type SkipReason = "UNSUPPORTED_TYPE";

export type ParseResult = {
  text: string;
  skipped?: SkipReason;
};

export type Parser = {
  id: "markdown" | "text" | "unsupported";
  parse: (input: string) => ParseResult;
};

export type ParserMeta = {
  ext?: string;
  mime?: string;
};
