import React, { useEffect, useRef } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { Channel, VoiceState } from "../../types";
import { ActiveScreenShare, useVoiceStore, EMPTY_VOICE_STATES } from "../../stores/voiceStore";
import { useAuthStore } from "../../stores/authStore";
import { useGuildStore } from "../../stores/guildStore";
import { useProfileModalStore } from "../../stores/profileModalStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useDMStore } from "../../stores/dmStore";
import { ScreenShareView } from "./ScreenShareView";
import {
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  Headphones,
  PhoneOff,
  Crown,
  LogIn,
  MonitorUp,
  MonitorOff,
  Tv,
  User as UserIcon,
  MessageSquare,
  Copy,
  EyeOff,
} from "lucide-react";

interface VoiceChannelViewProps {
  channel: Channel;
}

const VoiceParticipantMenu: React.FC<{
  vs: VoiceState;
  children: React.ReactNode;
  className?: string;
}> = ({ vs, children, className }) => {
  const currentUser = useAuthStore((s) => s.user);
  const openProfile = useProfileModalStore((s) => s.openProfile);
  const openDM = useDMStore((s) => s.openDM);
  const selectGuild = useGuildStore((s) => s.selectGuild);
  const syncUserAudio = useVoiceStore((s) => s.syncUserAudio);

  const userVolumes = useSettingsStore((s) => s.userVolumes);
  const localMutedUsers = useSettingsStore((s) => s.localMutedUsers);
  const setUserVolume = useSettingsStore((s) => s.setUserVolume);
  const toggleLocalMute = useSettingsStore((s) => s.toggleLocalMute);

  const vsUser = vs.member?.user;
  const vsName =
    vs.member?.nick ||
    vsUser?.global_name ||
    vsUser?.username ||
    "Usuário";
  const isSelf = currentUser && vs.user_id === currentUser.id;

  const handleOpenProfile = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (vsUser) {
      openProfile(vsUser, {
        nick: vs.member?.nick,
        joinedAt: vs.member?.joined_at,
        inVoice: true,
      });
    }
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div onClick={handleOpenProfile} className={className}>
          {children}
        </div>
      </ContextMenu.Trigger>

      <ContextMenu.Portal>
        <ContextMenu.Content className="w-56 bg-[#111214] border border-[#2b2d31] p-1.5 rounded-md shadow-xl text-sm font-medium z-50 text-[#dbdee1] animate-in fade-in-0 zoom-in-95">
          <div className="px-2 py-1 text-xs font-bold text-[#949ba4] uppercase truncate">
            {vsName}
          </div>
          <ContextMenu.Separator className="h-[1px] bg-[#2b2d31] my-1" />

          {/* Profile Action */}
          <ContextMenu.Item
            onClick={handleOpenProfile}
            className="flex items-center justify-between px-2.5 py-1.5 rounded text-xs hover:bg-[#5865F2] hover:text-white cursor-pointer transition-colors outline-none"
          >
            <span>Ver Perfil</span>
            <UserIcon className="w-3.5 h-3.5" />
          </ContextMenu.Item>

          {/* Direct Message Action */}
          {!isSelf && (
            <ContextMenu.Item
              onClick={async () => {
                try {
                  await openDM(vs.user_id);
                  selectGuild("");
                } catch (err) {
                  console.error("Failed to open DM:", err);
                }
              }}
              className="flex items-center justify-between px-2.5 py-1.5 rounded text-xs hover:bg-[#5865F2] hover:text-white cursor-pointer transition-colors outline-none"
            >
              <span>Enviar Mensagem Direta</span>
              <MessageSquare className="w-3.5 h-3.5" />
            </ContextMenu.Item>
          )}

          {/* Copy ID Action */}
          <ContextMenu.Item
            onClick={() => {
              navigator.clipboard.writeText(vs.user_id);
            }}
            className="flex items-center justify-between px-2.5 py-1.5 rounded text-xs hover:bg-[#5865F2] hover:text-white cursor-pointer transition-colors outline-none"
          >
            <span>Copiar ID</span>
            <Copy className="w-3.5 h-3.5" />
          </ContextMenu.Item>

          {/* Individual Audio Controls (if not self) */}
          {!isSelf && (
            <>
              <ContextMenu.Separator className="h-[1px] bg-[#2b2d31] my-1" />

              {/* Local Volume Slider 0% - 200% */}
              <div className="px-2.5 py-2 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-[#dbdee1] font-medium">
                    <Volume2 className="w-3.5 h-3.5 text-[#949ba4]" />
                    Volume do Usuário
                  </span>
                  <span className="text-white font-bold text-[11px]">
                    {userVolumes[vs.user_id] !== undefined
                      ? userVolumes[vs.user_id]
                      : 100}
                    %
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={
                    userVolumes[vs.user_id] !== undefined
                      ? userVolumes[vs.user_id]
                      : 100
                  }
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setUserVolume(vs.user_id, val);
                    syncUserAudio(vs.user_id);
                  }}
                  className="w-full accent-[#5865F2] cursor-pointer h-1.5"
                />
              </div>

              {/* Local Mute Toggle */}
              <ContextMenu.Item
                onClick={() => {
                  toggleLocalMute(vs.user_id);
                  syncUserAudio(vs.user_id);
                }}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs cursor-pointer transition-colors outline-none ${
                  localMutedUsers[vs.user_id]
                    ? "text-[#f23f43] bg-[#f23f43]/10"
                    : "hover:bg-[#5865F2] hover:text-white"
                }`}
              >
                <span>
                  {localMutedUsers[vs.user_id]
                    ? "Desmutar localmente"
                    : "Mutar localmente"}
                </span>
                <VolumeX className="w-3.5 h-3.5" />
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
};

const StreamPreviewCard: React.FC<{
  share: ActiveScreenShare;
  onClick: () => void;
}> = ({ share, onClick }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !share.videoTrack) return;
    share.videoTrack.attach(el);
    return () => {
      share.videoTrack.detach(el);
    };
  }, [share.videoTrack]);

  return (
    <div
      onClick={onClick}
      className="relative flex flex-col rounded-xl bg-black border border-[#383a40] overflow-hidden group cursor-pointer hover:border-[#5865F2] transition shadow-lg min-h-[170px]"
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
        <div className="p-2.5 rounded-full bg-[#5865F2] text-white shadow-md">
          <Tv className="w-5 h-5" />
        </div>
        <span className="text-xs font-semibold text-white drop-shadow">
          Assistir Transmissão
        </span>
      </div>
      <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#f23f43] text-white text-[10px] font-bold">
        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        <span>AO VIVO</span>
      </div>
      <div className="absolute bottom-2 left-2 right-2 truncate text-xs font-semibold text-white drop-shadow bg-black/60 px-2 py-1 rounded">
        {share.isLocal ? "Sua Transmissão" : `Transmissão de ${share.userName}`}
      </div>
    </div>
  );
};

export const VoiceChannelView: React.FC<VoiceChannelViewProps> = ({ channel }) => {
  const { user } = useAuthStore();
  const guilds = useGuildStore((s) => s.guilds);
  const currentGuild = guilds.find((g) => g.id === channel.guild_id);

  const {
    voiceStatesByGuild,
    activeVoiceChannelId,
    joinVoiceChannel,
    leaveVoiceChannel,
    toggleMute,
    toggleDeafen,
    toggleScreenShare,
    isMuted,
    isDeafened,
    isScreenSharing,
    activeScreenShares,
    focusedScreenShareUserId,
    setFocusedScreenShareUserId,
    isUserSpeaking,
  } = useVoiceStore();

  const isConnectedToThisChannel = activeVoiceChannelId === channel.id;

  const guildVoiceStates: VoiceState[] =
    (channel.guild_id && voiceStatesByGuild[channel.guild_id]) || EMPTY_VOICE_STATES;
  const channelParticipants = guildVoiceStates.filter((vs: VoiceState) => vs.channel_id === channel.id);

  const focusedShare = activeScreenShares.find(
    (s) => s.userId === focusedScreenShareUserId
  );

  const getInitial = (name?: string): string => {
    return name ? name.charAt(0).toUpperCase() : "?";
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1e1f22] select-none overflow-hidden">
      {/* 1. Voice Channel Header & Action Bar */}
      <div className="h-14 border-b border-[#1f2023] px-6 flex items-center justify-between bg-[#2b2d31]/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#23a55a]/20 flex items-center justify-center text-[#23a55a]">
            <Volume2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white leading-tight">{channel.name}</h2>
              {activeScreenShares.length > 0 && (
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#f23f43] text-white text-[10px] font-bold">
                  <Tv className="w-3 h-3" />
                  <span>{activeScreenShares.length} AO VIVO</span>
                </div>
              )}
            </div>
            <span className="text-xs text-[#949ba4]">
              {channelParticipants.length === 1
                ? "1 pessoa conectada"
                : `${channelParticipants.length} pessoas conectadas`}
            </span>
          </div>
        </div>

        <div>
          {isConnectedToThisChannel ? (
            <div className="flex items-center gap-2">
              {/* Stop Watching Remote Screen Share Button */}
              {focusedShare && !focusedShare.isLocal && (
                <button
                  type="button"
                  onClick={() => setFocusedScreenShareUserId(null)}
                  title="Parar de assistir à transmissão"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[#35373c] hover:bg-[#da373b] hover:text-white text-[#dbdee1] transition cursor-pointer"
                >
                  <EyeOff className="w-3.5 h-3.5" />
                  <span>Parar de Assistir</span>
                </button>
              )}

              {/* Share Screen Button */}
              <button
                type="button"
                onClick={toggleScreenShare}
                title={isScreenSharing ? "Parar Transmissão" : "Compartilhar Tela"}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition cursor-pointer ${
                  isScreenSharing
                    ? "bg-[#5865F2] hover:bg-[#4752c4] text-white shadow-md"
                    : "bg-[#35373c] hover:bg-[#404249] text-[#dbdee1]"
                }`}
              >
                {isScreenSharing ? (
                  <MonitorOff className="w-3.5 h-3.5 text-white" />
                ) : (
                  <MonitorUp className="w-3.5 h-3.5" />
                )}
                <span>{isScreenSharing ? "Transmitindo" : "Compartilhar Tela"}</span>
              </button>

              {/* Mute Button */}
              <button
                type="button"
                onClick={toggleMute}
                title={isMuted ? "Desmutar Microfone" : "Mutar Microfone"}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition cursor-pointer ${
                  isMuted
                    ? "bg-[#f23f43] text-white"
                    : "bg-[#35373c] hover:bg-[#404249] text-[#dbdee1]"
                }`}
              >
                {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                <span>{isMuted ? "Mutado" : "Mutar"}</span>
              </button>

              {/* Deafen Button */}
              <button
                type="button"
                onClick={toggleDeafen}
                title={isDeafened ? "Desensurdecer Áudio" : "Ensurdecer Áudio"}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition cursor-pointer ${
                  isDeafened
                    ? "bg-[#f23f43] text-white"
                    : "bg-[#35373c] hover:bg-[#404249] text-[#dbdee1]"
                }`}
              >
                <Headphones className="w-3.5 h-3.5" />
                <span>{isDeafened ? "Ensurdecido" : "Ensurdecer"}</span>
              </button>

              {/* Disconnect Button */}
              <button
                type="button"
                onClick={leaveVoiceChannel}
                title="Desconectar"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[#f23f43] hover:bg-[#da373b] text-white transition cursor-pointer ml-1"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                <span>Desconectar</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (channel.guild_id) {
                  joinVoiceChannel(channel.guild_id, channel.id, channel.name);
                }
              }}
              className="flex items-center gap-2 px-4 py-2 rounded bg-[#23a55a] hover:bg-[#1f9250] text-white font-semibold text-xs transition cursor-pointer shadow-md"
            >
              <LogIn className="w-4 h-4" />
              <span>Entrar na Voz</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Main Viewport Area (Theater Mode or Grid Mode) */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0 p-4">
        {focusedShare ? (
          // ==============================
          // THEATER MODE (Focused Screen)
          // ==============================
          <div className="flex-1 flex flex-col gap-4 overflow-hidden min-h-0">
            {/* Main Screen Stream Player */}
            <div className="flex-1 min-h-0">
              <ScreenShareView
                screenShare={focusedShare}
                channelName={channel.name}
                onMinimize={() => setFocusedScreenShareUserId(null)}
                onStopWatching={() => setFocusedScreenShareUserId(null)}
              />
            </div>

            {/* Bottom Filmstrip of Participants and Streams */}
            <div className="h-28 min-h-[112px] flex items-center gap-3 overflow-x-auto pb-1 select-none">
              {/* Other Active Streams Thumbnail Buttons */}
              {activeScreenShares
                .filter((s) => s.userId !== focusedShare.userId)
                .map((share) => (
                  <button
                    key={share.userId}
                    type="button"
                    onClick={() => setFocusedScreenShareUserId(share.userId)}
                    className="h-24 w-40 rounded-lg bg-black border border-[#5865F2] overflow-hidden shrink-0 relative hover:opacity-90 transition cursor-pointer"
                  >
                    <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-[#f23f43] text-white text-[9px] font-bold">
                      AO VIVO
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center text-xs font-medium text-white bg-black/40">
                      Assistir {share.isLocal ? "Sua Transmissão" : `Transmissão de ${share.userName}`}
                    </div>
                  </button>
                ))}

              {/* Participant Cards Filmstrip */}
              {channelParticipants.map((vs) => {
                const vsUser = vs.member?.user;
                const vsName =
                  vs.member?.nick ||
                  vsUser?.global_name ||
                  vsUser?.username ||
                  "Usuário";
                const isSelf = user && vs.user_id === user.id;
                const isMutedEffective = isSelf ? isMuted : vs.self_mute;
                const isDeafEffective = isSelf ? isDeafened : vs.self_deaf;
                const speaking = isUserSpeaking(vs.user_id);

                return (
                  <VoiceParticipantMenu
                    key={vs.user_id}
                    vs={vs}
                    className={`h-24 w-32 shrink-0 flex flex-col items-center justify-center rounded-lg bg-[#2b2d31] p-2 border transition-all duration-150 cursor-pointer ${
                      speaking
                        ? "border-[#23a55a] shadow-[0_0_8px_rgba(35,165,90,0.35)]"
                        : "border-[#383a40]/60 hover:border-[#4e5058]"
                    }`}
                  >
                    <div className="relative mb-1">
                      <div
                        className={`w-10 h-10 rounded-full bg-[#5865F2] flex items-center justify-center text-sm font-bold text-white overflow-hidden ${
                          speaking ? "ring-2 ring-[#23a55a]" : ""
                        }`}
                      >
                        {vsUser?.avatar ? (
                          <img
                            src={vsUser.avatar}
                            alt={vsName}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          getInitial(vsName)
                        )}
                      </div>
                      <div className="absolute -bottom-1 -right-1 flex items-center bg-[#111214] p-0.5 rounded-full border border-[#2b2d31]">
                        {isDeafEffective ? (
                          <Headphones className="w-2.5 h-2.5 text-[#f23f43]" />
                        ) : isMutedEffective ? (
                          <MicOff className="w-2.5 h-2.5 text-[#f23f43]" />
                        ) : speaking ? (
                          <Mic className="w-2.5 h-2.5 text-[#23a55a]" />
                        ) : (
                          <Mic className="w-2.5 h-2.5 text-[#80848e]" />
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-white truncate max-w-full text-center font-medium">
                      {vsName}
                      {isSelf && " (Você)"}
                    </span>
                  </VoiceParticipantMenu>
                );
              })}
            </div>
          </div>
        ) : (
          // ==============================
          // GRID MODE (Participants + Streams)
          // ==============================
          <div className="flex-1 overflow-y-auto min-h-0">
            {channelParticipants.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <div className="w-20 h-20 rounded-full bg-[#2b2d31] flex items-center justify-center text-[#80848e] mb-4">
                  <Volume2 className="w-10 h-10" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Ninguém está aqui ainda</h3>
                <p className="text-sm text-[#949ba4] max-w-sm mb-6">
                  Este canal está silencioso. Clique em "Entrar no Canal de Voz" para conectar seu microfone e conversar com seus amigos.
                </p>
                {!isConnectedToThisChannel && (
                  <button
                    type="button"
                    onClick={() => {
                      if (channel.guild_id) {
                        joinVoiceChannel(channel.guild_id, channel.id, channel.name);
                      }
                    }}
                    className="flex items-center gap-2 px-6 py-2.5 rounded bg-[#23a55a] hover:bg-[#1f9250] text-white font-semibold text-sm transition cursor-pointer shadow-lg"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>Entrar no Canal de Voz</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 auto-rows-fr">
                {/* Active Screen Share Tiles */}
                {activeScreenShares.map((share) => (
                  <StreamPreviewCard
                    key={`stream-${share.userId}`}
                    share={share}
                    onClick={() => setFocusedScreenShareUserId(share.userId)}
                  />
                ))}

                {/* Participant Voice Cards */}
                {channelParticipants.map((vs) => {
                  const vsUser = vs.member?.user;
                  const vsName =
                    vs.member?.nick ||
                    vsUser?.global_name ||
                    vsUser?.username ||
                    "User";
                  const isOwner = currentGuild && vs.user_id === currentGuild.owner_id;
                  const isSelf = user && vs.user_id === user.id;
                  const isMutedEffective = isSelf ? isMuted : vs.self_mute;
                  const isDeafEffective = isSelf ? isDeafened : vs.self_deaf;
                  const speaking = isUserSpeaking(vs.user_id);
                  const isUserStreaming =
                    vs.self_stream ||
                    activeScreenShares.some((s) => s.userId === vs.user_id);

                  return (
                    <VoiceParticipantMenu
                      key={vs.user_id}
                      vs={vs}
                      className={`relative flex flex-col items-center justify-center p-6 rounded-xl bg-[#2b2d31] border transition-all duration-150 min-h-[170px] cursor-pointer ${
                        speaking
                          ? "border-[#23a55a] shadow-[0_0_16px_rgba(35,165,90,0.35)]"
                          : "border-[#383a40]/60 hover:border-[#4e5058]"
                      }`}
                    >
                      {/* Streaming Badge */}
                      {isUserStreaming && (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setFocusedScreenShareUserId(vs.user_id);
                          }}
                          className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#f23f43] hover:bg-[#da373b] text-white text-[10px] font-bold cursor-pointer transition shadow z-10"
                          title="Assistir Transmissão"
                        >
                          <Tv className="w-3 h-3" />
                          <span>AO VIVO</span>
                        </div>
                      )}

                      {/* Avatar with speaking glow */}
                      <div className="relative mb-3">
                        <div
                          className={`w-20 h-20 rounded-full bg-[#5865F2] flex items-center justify-center text-2xl font-bold text-white overflow-hidden transition-all duration-150 ${
                            speaking
                              ? "ring-4 ring-[#23a55a] scale-105 shadow-[0_0_12px_#23a55a]"
                              : ""
                          }`}
                        >
                          {vsUser?.avatar ? (
                            <img
                              src={vsUser.avatar}
                              alt={vsName}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            getInitial(vsName)
                          )}
                        </div>

                        {/* Mute / Deafen status indicators */}
                        <div className="absolute -bottom-1 -right-1 flex items-center gap-1 bg-[#111214] p-1 rounded-full border border-[#2b2d31]">
                          {isDeafEffective ? (
                            <Headphones className="w-3.5 h-3.5 text-[#f23f43]" />
                          ) : isMutedEffective ? (
                            <MicOff className="w-3.5 h-3.5 text-[#f23f43]" />
                          ) : speaking ? (
                            <Mic className="w-3.5 h-3.5 text-[#23a55a]" />
                          ) : (
                            <Mic className="w-3.5 h-3.5 text-[#80848e]" />
                          )}
                        </div>
                      </div>

                      {/* Name and labels */}
                      <div className="flex items-center gap-1.5 max-w-full px-2">
                        <span className="text-sm font-semibold text-white truncate text-center">
                          {vsName}
                          {isSelf && " (Você)"}
                        </span>
                        {isOwner && (
                          <span title="Dono do Servidor">
                            <Crown className="w-3.5 h-3.5 text-[#f0b232] shrink-0" />
                          </span>
                        )}
                      </div>
                    </VoiceParticipantMenu>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
