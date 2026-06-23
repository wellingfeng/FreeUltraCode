import {
  workspaceFileDiff,
  type WorkspaceChangeFile,
} from './tauri';

export interface WorkspaceFileDiffRequest {
  rootPath: string | null | undefined;
  path: string | null | undefined;
}

function normalizeInput(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

/**
 * ScanHost boundary for VCS-backed work.
 * This is intentionally single-file and caller-driven: no status scan, no cache
 * warmup, no polling, no background queue.
 */
export async function readWorkspaceFileDiffOnDemand({
  rootPath,
  path,
}: WorkspaceFileDiffRequest): Promise<WorkspaceChangeFile | null> {
  const normalizedRoot = normalizeInput(rootPath);
  const normalizedPath = normalizeInput(path);
  if (!normalizedRoot || !normalizedPath) return null;
  return workspaceFileDiff(normalizedRoot, normalizedPath);
}
