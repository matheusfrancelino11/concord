import React, { useEffect, useState } from "react";
import { Sparkles, Download, RefreshCw, X, CheckCircle2 } from "lucide-react";
import { check, Update } from "@tauri-apps/plugin-updater";

export const UpdateBanner: React.FC = () => {
  const [update, setUpdate] = useState<Update | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0); // 0 to 100
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  const checkForUpdates = async () => {
    // Only check if running inside Tauri desktop environment
    if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
      return;
    }

    try {
      const availableUpdate = await check();
      if (availableUpdate) {
        setUpdate(availableUpdate);
      }
    } catch (err) {
      console.warn("[AutoUpdater] Update check failed or offline:", err);
    }
  };

  useEffect(() => {
    // Initial check 3 seconds after startup
    const timer = setTimeout(checkForUpdates, 3000);
    // Periodic check every 30 minutes
    const interval = setInterval(checkForUpdates, 30 * 60 * 1000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  const handleInstall = async () => {
    if (!update) return;

    try {
      setIsDownloading(true);
      let received = 0;
      let total = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength || 0;
          setTotalBytes(total);
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          setDownloadedBytes(received);
          if (total > 0) {
            setProgress(Math.min(100, Math.round((received / total) * 100)));
          }
        } else if (event.event === "Finished") {
          setIsInstalled(true);
        }
      });
    } catch (err) {
      console.error("[AutoUpdater] Failed to install update:", err);
      alert("Erro ao baixar a atualização. Tente novamente mais tarde.");
      setIsDownloading(false);
    }
  };

  if (!update || isDismissed) return null;

  return (
    <div className="bg-gradient-to-r from-[#5865F2] to-[#4752c4] text-white px-4 py-2 flex items-center justify-between shadow-md z-40 select-none animate-in slide-in-from-top-full duration-300">
      <div className="flex items-center gap-3">
        <div className="p-1.5 rounded-full bg-white/20">
          <Sparkles className="w-4 h-4 text-yellow-300" />
        </div>
        <div>
          <span className="font-bold text-xs">Nova Atualização Disponível!</span>
          <span className="text-xs text-white/90 ml-2">
            O Concord v{update.version} está pronto para ser instalado.
          </span>
          {isDownloading && totalBytes > 0 && (
            <span className="text-xs font-mono ml-2 text-yellow-200">
              ({progress}% - {(downloadedBytes / (1024 * 1024)).toFixed(1)}MB /{" "}
              {(totalBytes / (1024 * 1024)).toFixed(1)}MB)
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isInstalled ? (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-200 bg-emerald-900/40 px-3 py-1 rounded">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Reiniciando...</span>
          </div>
        ) : isDownloading ? (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-black/30 rounded text-xs font-medium">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>Instalando...</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleInstall}
            className="flex items-center gap-1.5 px-3 py-1 rounded bg-white text-[#5865F2] hover:bg-white/90 font-bold text-xs transition cursor-pointer shadow"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Atualizar Agora</span>
          </button>
        )}

        {!isDownloading && (
          <button
            type="button"
            onClick={() => setIsDismissed(true)}
            title="Lembrar mais tarde"
            className="p-1 hover:bg-white/10 rounded transition text-white/80 hover:text-white cursor-pointer ml-1"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
