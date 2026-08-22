import {
  flushSecureStorage,
  flushSecretsToLocalStorageFallback,
} from "@/lib/secureStorage";
import { flushGenerationSettings } from "@/lib/generationSettingsStore";
import { flushRemoteProfileWrites } from "@/lib/settingsProfile";

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/**
 * 安装「退出前落盘兜底」：
 * - 浏览器 beforeunload：同步把内存中的密钥写回 localStorage 镜像。
 * - Tauri 宿主：监听托盘右键菜单「退出」发出的 `ugs:before-quit` 事件，先同步
 *   落盘 localStorage 兜底，再尽力冲刷 OS keychain、生图/音频/视频等生成类
 *   设置磁盘写入，以及远程 project profile 写入，完成后通知宿主（invoke
 *   `ugs_quit_flush_done`）放行退出；宿主侧另有 1.5s 超时兜底，不会卡死退出。
 * 浏览器 / dev 构建下自动跳过 Tauri 部分，beforeunload 兜底始终生效。
 */
export async function installQuitFlushHandler(): Promise<void> {
  if (hasWindow()) {
    window.addEventListener("beforeunload", () => {
      flushSecretsToLocalStorageFallback();
    });
  }
  const { isTauri } = await import("@/lib/tauri");
  if (!isTauri()) return;
  try {
    const { listen } = await import("@tauri-apps/api/event");
    await listen("ugs:before-quit", () => {
      flushSecretsToLocalStorageFallback();
      void Promise.all([
        flushSecureStorage().catch(() => {
          /* keychain write failed — localStorage fallback above still applies */
        }),
        flushGenerationSettings().catch(() => {
          /* disk write failed — localStorage mirror above still applies */
        }),
        flushRemoteProfileWrites().catch(() => {
          /* remote write failed — server copy may be stale */
        }),
      ]).finally(() => {
        void import("@tauri-apps/api/core")
          .then(({ invoke }) => invoke("ugs_quit_flush_done"))
          .catch(() => {
            /* host already gone */
          });
      });
    });
  } catch (err) {
    console.warn("[quitFlush] before-quit handler unavailable", err);
  }
}
