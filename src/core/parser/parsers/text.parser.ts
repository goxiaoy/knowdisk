import type { Parser } from "../parser.types";

export const textParser: Parser = {
  id: "text",
  parse(input: string) {
    return { text: input };
  },
};
