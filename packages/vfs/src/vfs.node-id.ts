import { createHash } from "node:crypto";

export function createVfsNodeId(input: { mountId: string; sourceRef: string }): string {
  const uuid = createDeterministicUuid(`node:${input.mountId}:${input.sourceRef}`);
  return Buffer.from(uuid, "utf8").toString("base64url");
}

export function createVfsParentId(input: {
  mountId: string;
  parentSourceRef: string | null;
}): string | null {
  if (!input.parentSourceRef) {
    return null;
  }
  return createVfsNodeId({
    mountId: input.mountId,
    sourceRef: input.parentSourceRef,
  });
}

export function decodeBase64UrlNodeIdToUuid(nodeId: string): string {
  return Buffer.from(nodeId, "base64url").toString("utf8");
}

function createDeterministicUuid(seed: string): string {
  const digest = createHash("sha256").update(seed).digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return formatUuid(bytes);
}

function formatUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
