import { createHash } from "node:crypto";

export function chunkDocument(input: { path: string; text: string }) {
  const checksum = createHash("sha256")
    .update(input.path + "\n" + input.text)
    .digest("hex");

  return [
    {
      chunkId: `${input.path}#0#${checksum.slice(0, 12)}`,
      content: input.text,
      checksum,
    },
  ];
}
