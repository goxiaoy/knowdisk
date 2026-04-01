export type DecodedVfsCursorToken = { mode: "local"; lastName: string; lastNodeId: string };

export function encodeVfsLocalCursorToken(input: { lastName: string; lastNodeId: string }): string {
  return encodeToken({ mode: "local", lastName: input.lastName, lastNodeId: input.lastNodeId });
}

export function decodeVfsCursorToken(token: string): DecodedVfsCursorToken {
  try {
    const text = Buffer.from(token, "base64").toString("utf8");
    const parsed = JSON.parse(text) as Record<string, unknown>;

    if (
      parsed.mode === "local" &&
      typeof parsed.lastName === "string" &&
      typeof parsed.lastNodeId === "string"
    ) {
      return {
        mode: "local",
        lastName: parsed.lastName,
        lastNodeId: parsed.lastNodeId,
      };
    }

    throw new Error("invalid-shape");
  } catch {
    throw new Error("Invalid VFS cursor token");
  }
}

function encodeToken(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}
