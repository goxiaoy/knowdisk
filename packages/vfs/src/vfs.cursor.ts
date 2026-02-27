export type DecodedVfsCursorToken =
  | { mode: "local"; lastName: string; lastNodeId: string }
  | { mode: "remote"; providerCursor: string };

export function encodeVfsLocalCursorToken(input: {
  lastName: string;
  lastNodeId: string;
}): string {
  return encodeToken({ mode: "local", lastName: input.lastName, lastNodeId: input.lastNodeId });
}

export function encodeVfsRemoteCursorToken(input: {
  providerCursor: string;
}): string {
  return encodeToken({ mode: "remote", providerCursor: input.providerCursor });
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

    if (parsed.mode === "remote" && typeof parsed.providerCursor === "string") {
      return {
        mode: "remote",
        providerCursor: parsed.providerCursor,
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
