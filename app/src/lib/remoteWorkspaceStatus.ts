import {
  RunnerClient,
  getRemoteWorkspace,
  isRemoteWorkspacePath,
  remoteWorkspaceIdFromPath,
  resolveRemoteRunnerConnectionAsync,
} from '@/lib/remoteWorkspace';

export const REMOTE_WORKSPACE_STATUS_CHECK_INTERVAL_MS = 15_000;

export type RemoteWorkspaceConnectionStatus =
  | 'checking'
  | 'connected'
  | 'failed'
  | 'unconfigured';

export interface RemoteWorkspaceConnectionState {
  status: RemoteWorkspaceConnectionStatus;
  detail?: string;
  checkedAt: number;
}

function state(
  status: RemoteWorkspaceConnectionStatus,
  detail?: string,
): RemoteWorkspaceConnectionState {
  return {
    status,
    detail,
    checkedAt: Date.now(),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function checkRemoteWorkspaceConnection(
  workspacePath: string,
  signal?: AbortSignal,
): Promise<RemoteWorkspaceConnectionState> {
  if (!isRemoteWorkspacePath(workspacePath)) {
    return state('unconfigured', '不是云端项目。');
  }

  const workspaceId = remoteWorkspaceIdFromPath(workspacePath);
  const config = getRemoteWorkspace(workspaceId);
  if (!config) return state('unconfigured', '云端项目配置不存在。');

  const connection = await resolveRemoteRunnerConnectionAsync(config);
  if (!connection) {
    return state('unconfigured', '云端服务地址或访问 Token 未配置。');
  }

  const client = new RunnerClient(connection.serverUrl, connection.token);
  const health = await client.health(signal);
  if (!health.ok) return state('failed', 'Runner 服务不可达。');

  try {
    if (config.projectId) {
      await client.getProject(config.projectId);
    } else {
      await client.projects();
    }
  } catch (err) {
    return state('failed', errorMessage(err) || 'Runner 鉴权或项目检查失败。');
  }

  return state(
    'connected',
    health.version ? `Runner ${health.version}` : 'Runner 服务正常。',
  );
}
