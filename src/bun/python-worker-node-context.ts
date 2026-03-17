import { join } from "node:path";
import type { VfsNode } from "@knowdisk/vfs";

export type PythonWorkerNodeContext = {
  node: {
    nodeId: string;
    mountId: string;
    name: string;
    sourceRef: string;
    providerVersion: string | null;
  };
  mount: {
    mountId: string;
    providerType: string;
    directory: string;
    contentDir: string;
  };
};

export async function buildPythonWorkerNodeContext(input: {
  nodeId: string;
  contentRootDir: string;
  getNodeById: (nodeId: string) => Promise<VfsNode | null> | VfsNode | null;
  getMountById: (mountId: string) => Promise<LocalMountLike | null> | LocalMountLike | null;
}): Promise<PythonWorkerNodeContext> {
  const node = await input.getNodeById(input.nodeId);
  if (!node) {
    throw new Error(`node not found: ${input.nodeId}`);
  }
  if (node.kind !== "file") {
    throw new Error(`node is not a file: ${input.nodeId}`);
  }

  const mount = await input.getMountById(node.mountId);
  if (!mount) {
    throw new Error(`mount not found: ${node.mountId}`);
  }
  if (mount.providerType !== "local") {
    throw new Error("python worker only supports local provider mounts");
  }

  const directory = normalizeLocalDirectory(mount.providerExtra);
  return {
    node: {
      nodeId: node.nodeId,
      mountId: node.mountId,
      name: node.name,
      sourceRef: node.sourceRef,
      providerVersion: node.providerVersion,
    },
    mount: {
      mountId: node.mountId,
      providerType: mount.providerType,
      directory,
      contentDir: join(input.contentRootDir, node.mountId),
    },
  };
}

type LocalMountLike = {
  mountId: string;
  providerType: string;
  providerExtra: Record<string, unknown>;
};

function normalizeLocalDirectory(providerExtra: Record<string, unknown>): string {
  const directory = providerExtra.directory;
  if (typeof directory !== "string" || directory.trim().length === 0) {
    throw new Error("local mount is missing providerExtra.directory");
  }
  return directory;
}
