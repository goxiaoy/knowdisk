import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { TextSplitter } from "./parser.types";

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});

export const defaultTextSplitter: TextSplitter = {
  id: "langchain-recursive-character",
  version: "1.0.1",
  async splitText(input) {
    return splitter.splitText(input.text);
  },
};
