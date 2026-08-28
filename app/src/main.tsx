// Must run before any module that reads localStorage (e.g. the store seed):
// migrates pre-rebrand `owf_*` keys to `ugs_*` so dev data survives the rename.
import "./lib/legacyStorageMigration";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles/global.css";
import { initializeSecureStorage } from "@/lib/secureStorage";
import { installQuitFlushHandler } from "@/lib/quitFlush";
import { initializeGenerationSettingsStore } from "@/lib/generationSettingsStore";
import { initializeGatewayConfigStore } from "@/lib/gatewayConfig";
import { initializeApiConfigStore } from "@/lib/apiConfig";
import { refreshModelPricing } from "@/lib/modelPricing";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found");
}

async function bootstrap(): Promise<void> {
  // Secure storage must be ready before gateway/api config hydration, because
  // those readers decide whether API keys live in the OS keychain. Hydrate it
  // first, then run the remaining independent initializers concurrently.
  await initializeSecureStorage();
  await Promise.all([
    initializeGenerationSettingsStore(),
    initializeGatewayConfigStore(),
  ]);
  await initializeApiConfigStore();
  // 退出兜底（托盘右键菜单「退出」/ 浏览器关闭）：把内存密钥同步落盘
  // localStorage，避免 keychain 异步写未完成时丢失就地编辑的 API Key。
  void installQuitFlushHandler();
  const [{ default: App }, { applyAppearance }, { useStore }] =
    await Promise.all([
      import("./App"),
      import("@/lib/appearance"),
      import("@/store/useStore"),
    ]);

  applyAppearance(useStore.getState().appearance);

  createRoot(rootEl!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // 启动时联网刷新一次模型价格目录（OpenRouter 公开接口），不阻塞渲染。
  void refreshModelPricing();
}

void bootstrap();
