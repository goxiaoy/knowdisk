import type { FileNodeMetadata } from "../../../shared/files";

type MetadataEntry = {
  key: keyof FileNodeMetadata;
  label: string;
  value: string;
};

const LABELS: Record<keyof FileNodeMetadata, string> = {
  nodeId: "Node ID",
  mountId: "Mount ID",
  parentId: "Parent ID",
  name: "Name",
  kind: "Kind",
  size: "Size",
  mtimeMs: "Modified",
  sourceRef: "Source Ref",
  providerVersion: "Provider Version",
  deletedAtMs: "Deleted",
  createdAtMs: "Created",
  updatedAtMs: "Updated",
};

export function formatFileNodeMetadataEntries(metadata: FileNodeMetadata): MetadataEntry[] {
  return (Object.keys(metadata) as Array<keyof FileNodeMetadata>).map((key) => ({
    key,
    label: LABELS[key],
    value: formatValue(key, metadata[key]),
  }));
}

function formatValue(key: keyof FileNodeMetadata, value: FileNodeMetadata[keyof FileNodeMetadata]): string {
  if (value === null) {
    return "—";
  }

  if (key === "size" && typeof value === "number") {
    return formatBytes(value);
  }

  if ((key === "mtimeMs" || key === "createdAtMs" || key === "updatedAtMs" || key === "deletedAtMs") && typeof value === "number") {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  }

  return String(value);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
