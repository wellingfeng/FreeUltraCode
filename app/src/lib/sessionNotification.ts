import type { IRRunStatus } from '@/core/ir';
import {
  focusMainWindow,
  notifySessionCompleteDesktop,
  onSessionNotificationClicked,
  tauriAvailable,
  type SessionNotificationClickPayload,
} from '@/lib/tauri';

export type SessionCompletionStatus = Extract<IRRunStatus, 'success' | 'error'>;
export type SessionNotificationKind = SessionCompletionStatus | 'waitingInput';

export interface SessionCompletionNotificationInput {
  status: SessionNotificationKind;
  sessionTitle?: string | null;
  detail?: string | null;
  workspaceId?: string | null;
  sessionId?: string | null;
}

const FALLBACK_BODY: Record<SessionNotificationKind, string> = {
  success: '可以回到 UltraGameStudio 查看结果。',
  error: '请回到 UltraGameStudio 查看错误详情。',
  waitingInput: '请回到 UltraGameStudio 选择或输入后继续。',
};

const WEB_NOTIFICATION_CLOSE_MS: Record<SessionNotificationKind, number> = {
  success: 5000,
  error: 5000,
  waitingInput: 15000,
};

let tauriPermissionPromise: Promise<boolean> | null = null;
let tauriClickListenerPromise: Promise<void> | null = null;
let sessionNotificationClickHandler:
  | ((payload: SessionNotificationClickPayload) => void)
  | null = null;

export function isNotifiableCompletionStatus(
  status: IRRunStatus | undefined,
): status is SessionCompletionStatus {
  return status === 'success' || status === 'error';
}

function compactNotificationText(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateNotificationText(value: string, maxLength = 160): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

export function sessionCompletionNotificationText(
  input: SessionCompletionNotificationInput,
): { title: string; body: string } {
  const title =
    input.status === 'success'
      ? '会话已完成'
      : input.status === 'waitingInput'
        ? '会话已暂停，等待你的输入'
        : '会话失败';
  const parts = [
    compactNotificationText(input.sessionTitle),
    compactNotificationText(input.detail),
  ].filter(Boolean);
  return {
    title,
    body: truncateNotificationText(parts.join(' · ') || FALLBACK_BODY[input.status]),
  };
}

function notificationTarget(
  input: Pick<SessionCompletionNotificationInput, 'workspaceId' | 'sessionId'>,
): SessionNotificationClickPayload {
  return {
    workspaceId: input.workspaceId ?? null,
    sessionId: input.sessionId ?? null,
  };
}

async function focusNotificationTarget(): Promise<void> {
  try {
    if (tauriAvailable()) {
      await focusMainWindow();
      return;
    }
    if (typeof window !== 'undefined') window.focus();
  } catch {
    /* Best-effort focus only. */
  }
}

function handleSessionNotificationClick(
  payload: SessionNotificationClickPayload,
): void {
  if (!payload.sessionId) return;
  void focusNotificationTarget();
  sessionNotificationClickHandler?.(payload);
}

async function ensureTauriNotificationClickListener(): Promise<void> {
  if (!tauriAvailable()) return;
  tauriClickListenerPromise ??= onSessionNotificationClicked((payload) => {
    handleSessionNotificationClick(payload);
  })
    .then(() => undefined)
    .catch(() => {
      tauriClickListenerPromise = null;
    });
  await tauriClickListenerPromise;
}

export function setSessionNotificationClickHandler(
  handler: (payload: SessionNotificationClickPayload) => void,
): () => void {
  sessionNotificationClickHandler = handler;
  void ensureTauriNotificationClickListener();
  return () => {
    if (sessionNotificationClickHandler === handler) {
      sessionNotificationClickHandler = null;
    }
  };
}

async function ensureTauriNotificationPermission(): Promise<boolean> {
  tauriPermissionPromise ??= (async () => {
    const { isPermissionGranted, requestPermission } = await import(
      '@tauri-apps/plugin-notification'
    );
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === 'granted';
  })();
  return tauriPermissionPromise.catch(() => {
    tauriPermissionPromise = null;
    return false;
  });
}

async function notifyViaTauri(input: SessionCompletionNotificationInput): Promise<boolean> {
  if (!(await ensureTauriNotificationPermission())) return false;
  const text = sessionCompletionNotificationText(input);
  let sent = false;
  try {
    sent = await notifySessionCompleteDesktop({
      ...text,
      ...notificationTarget(input),
      kind: input.status,
    });
  } catch {
    sent = false;
  }
  if (sent) {
    void ensureTauriNotificationClickListener();
    return true;
  }
  const { sendNotification } = await import('@tauri-apps/plugin-notification');
  sendNotification(text);
  return true;
}

async function notifyViaWeb(input: SessionCompletionNotificationInput): Promise<void> {
  const NotificationCtor =
    typeof globalThis !== 'undefined'
      ? (globalThis as typeof globalThis & { Notification?: typeof Notification })
          .Notification
      : undefined;
  if (!NotificationCtor) return;
  if (NotificationCtor.permission === 'default') {
    await NotificationCtor.requestPermission();
  }
  if (NotificationCtor.permission !== 'granted') return;
  const text = sessionCompletionNotificationText(input);
  const notification = new NotificationCtor(text.title, { body: text.body });
  notification.onclick = () => {
    notification.close();
    handleSessionNotificationClick(notificationTarget(input));
  };
  globalThis.setTimeout(
    () => notification.close(),
    WEB_NOTIFICATION_CLOSE_MS[input.status],
  );
}

export async function notifySessionComplete(
  input: SessionCompletionNotificationInput,
): Promise<void> {
  try {
    if (tauriAvailable() && (await notifyViaTauri(input))) return;
    await notifyViaWeb(input);
  } catch {
    /* Notification is best-effort; never fail the completed session. */
  }
}
