import React from "react";
import { useVoiceStore } from "../../stores/voiceStore";
import { useGuildStore } from "../../stores/guildStore";
import { PhoneOff, Wifi, AlertCircle, MonitorUp, MonitorOff, MicOff } from "lucide-react";

export const VoiceControls: React.FC = () => {
  const {
    connectionStatus,
    activeVoiceGuildId,
    activeVoiceChannelName,
    leaveVoiceChannel,
    isScreenSharing,
    toggleScreenShare,
    error,
    micPermissionBlocked,
    repairMicPermissions,
    openWindowsMicSettings,
  } = useVoiceStore();
  const guilds = useGuildStore((s) => s.guilds);

  if (connectionStatus === "disconnected" && !error) {
    return null;
  }

  const currentGuild = guilds.find((g) => g.id === activeVoiceGuildId);
  const serverName = currentGuild ? currentGuild.name : "Concord";

  const isConnected = connectionStatus === "connected";
  const isConnecting = connectionStatus === "connecting";
  const isError = connectionStatus === "error";

  return (
    <div className="bg-[#111214] border-t border-[#1f2023] px-3 py-2 select-none">
      <div className="flex items-center justify-between">
        {/* Left: Status icon & channel details */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="shrink-0">
            {isConnected && <Wifi className="w-4 h-4 text-[#23a55a]" />}
            {isConnecting && <Wifi className="w-4 h-4 text-[#f0b232] animate-pulse" />}
            {isError && <AlertCircle className="w-4 h-4 text-[#f23f43]" />}
          </div>

          <div className="flex flex-col min-w-0">
            <span
              className={`text-xs font-semibold leading-tight truncate ${
                isConnected
                  ? "text-[#23a55a]"
                  : isConnecting
                  ? "text-[#f0b232]"
                  : "text-[#f23f43]"
              }`}
            >
              {isConnected
                ? "Voz Conectada"
                : isConnecting
                ? "Conectando RTC..."
                : "Erro de Conexão"}
            </span>
            <span className="text-[11px] text-[#949ba4] leading-tight truncate">
              {activeVoiceChannelName || "Canal de Voz"} / {serverName}
            </span>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {isConnected && (
            <button
              type="button"
              onClick={toggleScreenShare}
              title={isScreenSharing ? "Parar Transmissão" : "Compartilhar Tela"}
              aria-label={isScreenSharing ? "Parar Transmissão" : "Compartilhar Tela"}
              className={`p-1.5 rounded transition cursor-pointer ${
                isScreenSharing
                  ? "bg-[#5865F2] hover:bg-[#4752c4] text-white"
                  : "bg-[#2b2d31] hover:bg-[#35373c] text-[#dbdee1]"
              }`}
            >
              {isScreenSharing ? (
                <MonitorOff className="w-4 h-4" />
              ) : (
                <MonitorUp className="w-4 h-4" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={leaveVoiceChannel}
            title="Desconectar da voz"
            aria-label="Desconectar da voz"
            className="p-1.5 rounded bg-[#2b2d31] hover:bg-[#f23f43] hover:text-white text-[#dbdee1] transition cursor-pointer"
          >
            <PhoneOff className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isError && error && (
        <div className="mt-1 text-[10px] text-[#f23f43] truncate" title={error}>
          {error}
        </div>
      )}

      {micPermissionBlocked && (
        <div className="mt-2 bg-[#f23f43]/15 border border-[#f23f43]/40 rounded p-2 flex items-center justify-between gap-2 text-xs text-[#f23f43] animate-in fade-in-50">
          <div className="flex items-center gap-1.5 min-w-0">
            <MicOff className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate font-medium">Microfone bloqueado</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={async () => {
                const ok = await repairMicPermissions();
                if (!ok) {
                  openWindowsMicSettings();
                }
              }}
              className="bg-[#f23f43] hover:bg-[#d83a3e] text-white text-[11px] font-semibold px-2 py-0.5 rounded transition cursor-pointer"
            >
              Desbloquear
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
