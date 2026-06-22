import { AlertTriangle, Loader2, Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { t, type Locale } from '@/lib/i18n';
import type {
  RemoteWorkspaceConnectionState,
  RemoteWorkspaceConnectionStatus,
} from '@/lib/remoteWorkspaceStatus';

export function remoteWorkspaceConnectionLabel(
  locale: Locale,
  status: RemoteWorkspaceConnectionStatus,
): string {
  if (status === 'connected') {
    return t(locale, 'remoteWorkspace.statusConnected');
  }
  if (status === 'failed') return t(locale, 'remoteWorkspace.statusFailed');
  if (status === 'unconfigured') {
    return t(locale, 'remoteWorkspace.statusUnconfigured');
  }
  return t(locale, 'remoteWorkspace.statusChecking');
}

export function remoteWorkspaceConnectionDotClassName(
  status: RemoteWorkspaceConnectionStatus,
): string {
  if (status === 'connected') {
    return 'bg-emerald-400 shadow-[0_0_0_2px_rgba(52,211,153,0.16)]';
  }
  if (status === 'failed') {
    return 'bg-red-400 shadow-[0_0_0_2px_rgba(248,113,113,0.16)]';
  }
  if (status === 'unconfigured') {
    return 'bg-amber-400 shadow-[0_0_0_2px_rgba(251,191,36,0.16)]';
  }
  return 'animate-pulse bg-sky-400 shadow-[0_0_0_2px_rgba(56,189,248,0.16)]';
}

function badgeClassName(status: RemoteWorkspaceConnectionStatus): string {
  if (status === 'connected') {
    return 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300';
  }
  if (status === 'failed') {
    return 'border-red-400/50 bg-red-400/10 text-red-300';
  }
  if (status === 'unconfigured') {
    return 'border-amber-400/45 bg-amber-400/10 text-amber-300';
  }
  return 'border-sky-400/40 bg-sky-400/10 text-sky-300';
}

function statusIcon(status: RemoteWorkspaceConnectionStatus) {
  if (status === 'connected') return Wifi;
  if (status === 'failed') return WifiOff;
  if (status === 'unconfigured') return AlertTriangle;
  return Loader2;
}

export default function RemoteWorkspaceStatusBadge({
  state,
  locale,
  showText = true,
  className,
}: {
  state?: RemoteWorkspaceConnectionState;
  locale: Locale;
  showText?: boolean;
  className?: string;
}) {
  const status = state?.status ?? 'checking';
  const label = remoteWorkspaceConnectionLabel(locale, status);
  const Icon = statusIcon(status);

  return (
    <span
      title={state?.detail ? `${label}：${state.detail}` : label}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded border px-1.5 text-[9px] font-medium leading-none',
        badgeClassName(status),
        className,
      )}
    >
      <Icon
        size={10}
        aria-hidden="true"
        className={cn('shrink-0', status === 'checking' && 'animate-spin')}
      />
      {showText && <span className="truncate">{label}</span>}
    </span>
  );
}
