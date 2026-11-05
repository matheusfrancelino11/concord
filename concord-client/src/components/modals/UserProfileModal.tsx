import React, { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { UserSummary } from "../../types";
import { X, Calendar, Copy, Check, MessageSquare, Camera, Volume2, VolumeX, Loader2 } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { useGuildStore } from "../../stores/guildStore";
import { useDMStore } from "../../stores/dmStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useVoiceStore } from "../../stores/voiceStore";
import { api } from "../../api/client";

interface UserProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserSummary;
  nick?: string | null;
  joinedAt?: string;
  roles?: Array<{ id: string; name: string; color: number }>;
  inVoice?: boolean;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  open,
  onOpenChange,
  user,
  nick,
  joinedAt,
  roles = [],
  inVoice = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentUser = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const selectGuild = useGuildStore((s) => s.selectGuild);
  const openDM = useDMStore((s) => s.openDM);

  const getUserVolume = useSettingsStore((s) => s.getUserVolume);
  const setUserVolume = useSettingsStore((s) => s.setUserVolume);
  const syncUserAudio = useVoiceStore((s) => s.syncUserAudio);
  const activeVoiceChannelId = useVoiceStore((s) => s.activeVoiceChannelId);

  const isSelf = currentUser?.id === user.id;
  const currentAvatar = isSelf && currentUser?.avatar ? currentUser.avatar : user.avatar;

  const displayName = isSelf
    ? currentUser?.global_name || currentUser?.username || user.username
    : nick || user.global_name || user.username;
  const initial = displayName.charAt(0).toUpperCase();

  const userVolume = getUserVolume(user.id);

  const handleVolumeChange = (newVol: number) => {
    setUserVolume(user.id, newVol);
    syncUserAudio(user.id);
  };

  const handleCopyId = () => {
    navigator.clipboard.writeText(user.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      const uploadRes = await api.uploads.upload(file);
      const updatedUser = await api.auth.updateMe({ avatar: uploadRes.url });
      updateUser({ avatar: updatedUser.avatar });
    } catch (err) {
      console.error("Failed to upload avatar:", err);
      alert("Erro ao alterar foto de perfil. Tente novamente.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const formattedDate = joinedAt
    ? new Date(joinedAt).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 animate-in fade-in-0" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] max-w-[90vw] bg-[#232428] text-[#dbdee1] rounded-2xl shadow-2xl overflow-hidden z-50 border border-[#2b2d31] outline-none">
          {/* Header Banner */}
          <div className="h-28 bg-gradient-to-r from-[#1FCE66] to-[#128a43] relative">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Profile Body */}
          <div className="px-6 pb-6 relative pt-0">
            {/* Avatar overlapping banner */}
            <div className="relative -mt-14 mb-3 inline-block">
              <div className="relative w-24 h-24 rounded-full bg-[#1FCE66] border-[6px] border-[#232428] flex items-center justify-center text-3xl font-bold text-white shadow-lg overflow-hidden group">
                {currentAvatar ? (
                  <img src={currentAvatar} alt={displayName} className="w-full h-full object-cover" />
                ) : (
                  initial
                )}

                {/* Self Avatar Upload Overlay */}
                {isSelf && (
                  <>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white text-[10px] font-medium cursor-pointer"
                    >
                      {isUploading ? (
                        <Loader2 className="w-6 h-6 animate-spin" />
                      ) : (
                        <>
                          <Camera className="w-5 h-5 mb-0.5" />
                          <span>Mudar Foto</span>
                        </>
                      )}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarFileChange}
                    />
                  </>
                )}
              </div>
            </div>

            {/* Names & User Card Box */}
            <div className="bg-[#111214] p-4 rounded-xl border border-[#2b2d31] space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-bold text-white leading-tight">{displayName}</h3>
                  <div className="text-sm text-[#949ba4]">@{user.username}</div>
                </div>

                {isSelf && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#2b2d31] hover:bg-[#35373c] text-xs font-medium text-white transition cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>{currentAvatar ? "Trocar Foto" : "Adicionar Foto"}</span>
                  </button>
                )}
              </div>

              {/* Direct Message Button */}
              {!isSelf && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await openDM(user.id);
                      selectGuild("");
                      onOpenChange(false);
                    } catch (err) {
                      console.error("Failed to open DM:", err);
                    }
                  }}
                  className="w-full flex items-center justify-center gap-2 bg-[#1FCE66] hover:bg-[#1bb85a] text-white py-2 rounded-lg font-medium text-xs transition cursor-pointer shadow"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Enviar Mensagem Direta</span>
                </button>
              )}

              {/* In-Call Volume Slider */}
              {(!isSelf && (inVoice || activeVoiceChannelId)) && (
                <div className="p-3 bg-[#1e1f22] rounded-lg border border-[#2b2d31] space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-[#dbdee1]">
                    <div className="flex items-center gap-1.5">
                      {userVolume === 0 ? (
                        <VolumeX className="w-4 h-4 text-[#f23f43]" />
                      ) : (
                        <Volume2 className="w-4 h-4 text-[#1FCE66]" />
                      )}
                      <span>Volume do Usuário</span>
                    </div>
                    <span className="text-[#949ba4] font-mono">{userVolume}%</span>
                  </div>

                  <input
                    type="range"
                    min="0"
                    max="200"
                    value={userVolume}
                    onChange={(e) => handleVolumeChange(Number(e.target.value))}
                    className="w-full h-1.5 bg-[#4e5058] rounded-lg appearance-none cursor-pointer accent-[#1FCE66]"
                  />

                  <div className="flex justify-between items-center text-[10px] text-[#949ba4] pt-0.5">
                    <button
                      type="button"
                      onClick={() => handleVolumeChange(userVolume === 0 ? 100 : 0)}
                      className="hover:text-white cursor-pointer"
                    >
                      {userVolume === 0 ? "Desmutar" : "Mutar Usuário"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleVolumeChange(100)}
                      className="hover:text-white cursor-pointer"
                    >
                      Resetar (100%)
                    </button>
                  </div>
                </div>
              )}

              <div className="h-[1px] bg-[#2b2d31]" />

              {/* Roles */}
              {roles.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold text-[#949ba4] uppercase tracking-wider mb-2">
                    Cargos ({roles.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {roles.map((r) => {
                      const hex = r.color ? `#${r.color.toString(16).padStart(6, "0")}` : "#99aab5";
                      return (
                        <div
                          key={r.id}
                          className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#2b2d31] text-xs font-medium text-[#dbdee1]"
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hex }} />
                          <span>{r.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Joined Date */}
              {formattedDate && (
                <div>
                  <div className="text-[11px] font-bold text-[#949ba4] uppercase tracking-wider mb-1">
                    Membro Desde
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[#dbdee1]">
                    <Calendar className="w-3.5 h-3.5 text-[#949ba4]" />
                    <span>{formattedDate}</span>
                  </div>
                </div>
              )}

              {/* User ID copy */}
              <div className="pt-1 flex items-center justify-between text-xs text-[#949ba4]">
                <span>ID: {user.id}</span>
                <button
                  type="button"
                  onClick={handleCopyId}
                  className="flex items-center gap-1 text-[#1FCE66] hover:underline font-medium cursor-pointer"
                >
                  {copied ? <Check className="w-3 h-3 text-[#23a55a]" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? "Copiado!" : "Copiar ID"}</span>
                </button>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
