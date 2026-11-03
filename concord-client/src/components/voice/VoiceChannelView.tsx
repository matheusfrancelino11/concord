import React from "react";
import { Channel } from "../../types";
import { useVoiceStore } from "../../stores/voiceStore";
import { useAuthStore } from "../../stores/authStore";
import { useGuildStore } from "../../stores/guildStore";
import { Volume2, Mic, MicOff, Headphones, PhoneOff, Crown, LogIn } from "lucide-react";

interface VoiceChannelViewProps {
  channel: Channel;
}

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
    isMuted,
    isDeafened,
    isUserSpeaking,
  } = useVoiceStore();

  const isConnectedToThisChannel = activeVoiceChannelId === channel.id;

  const guildVoiceStates = voiceStatesByGuild[channel.guild_id] || [];
  const channelParticipants = guildVoiceStates.filter((vs) => vs.channel_id === channel.id);

  const getInitial = (name?: string): string => {
    return name ? name.charAt(0).toUpperCase() : "?";
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1e1f22] select-none overflow-hidden">
      {/* 1. Voice Channel Header & Action Bar */}
      <div className="h-14 border-b border-[#1f2023] px-6 flex items-center justify-between bg-[#2b2d31]/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#23a55a]/20 flex items-center justify-center text-[#23a55a]">
            <Volume2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white leading-tight">{channel.name}</h2>
            <span className="text-xs text-[#949ba4]">
              {channelParticipants.length === 1
                ? "1 person in voice"
                : `${channelParticipants.length} people in voice`}
            </span>
          </div>
        </div>

        <div>
          {isConnectedToThisChannel ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleMute}
                title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition cursor-pointer ${
                  isMuted
                    ? "bg-[#f23f43] text-white"
                    : "bg-[#35373c] hover:bg-[#404249] text-[#dbdee1]"
                }`}
              >
                {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                <span>{isMuted ? "Muted" : "Mute"}</span>
              </button>

              <button
                type="button"
                onClick={toggleDeafen}
                title={isDeafened ? "Undeafen Audio" : "Deafen Audio"}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition cursor-pointer ${
                  isDeafened
                    ? "bg-[#f23f43] text-white"
                    : "bg-[#35373c] hover:bg-[#404249] text-[#dbdee1]"
                }`}
              >
                <Headphones className="w-3.5 h-3.5" />
                <span>{isDeafened ? "Deafened" : "Deafen"}</span>
              </button>

              <button
                type="button"
                onClick={leaveVoiceChannel}
                title="Disconnect"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[#f23f43] hover:bg-[#da373b] text-white transition cursor-pointer ml-1"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => joinVoiceChannel(channel.guild_id, channel.id, channel.name)}
              className="flex items-center gap-2 px-4 py-2 rounded bg-[#23a55a] hover:bg-[#1f9250] text-white font-semibold text-xs transition cursor-pointer shadow-md"
            >
              <LogIn className="w-4 h-4" />
              <span>Join Voice</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Participants Grid Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {channelParticipants.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <div className="w-20 h-20 rounded-full bg-[#2b2d31] flex items-center justify-center text-[#80848e] mb-4">
              <Volume2 className="w-10 h-10" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Nobody is here yet</h3>
            <p className="text-sm text-[#949ba4] max-w-sm mb-6">
              This channel is quiet. Click "Join Voice" to connect your microphone and talk with your friends.
            </p>
            {!isConnectedToThisChannel && (
              <button
                type="button"
                onClick={() => joinVoiceChannel(channel.guild_id, channel.id, channel.name)}
                className="flex items-center gap-2 px-6 py-2.5 rounded bg-[#23a55a] hover:bg-[#1f9250] text-white font-semibold text-sm transition cursor-pointer shadow-lg"
              >
                <LogIn className="w-4 h-4" />
                <span>Join Voice Channel</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 auto-rows-fr">
            {channelParticipants.map((vs) => {
              const vsUser = vs.member?.user;
              const vsName =
                vs.member?.nick ||
                vsUser?.global_name ||
                vsUser?.username ||
                "User";
              const isOwner = currentGuild && vs.user_id === currentGuild.owner_id;
              const isSelf = user && vs.user_id === user.id;
              const speaking = isUserSpeaking(vs.user_id);

              return (
                <div
                  key={vs.user_id}
                  className={`relative flex flex-col items-center justify-center p-6 rounded-xl bg-[#2b2d31] border transition-all duration-150 min-h-[170px] ${
                    speaking
                      ? "border-[#23a55a] shadow-[0_0_16px_rgba(35,165,90,0.35)]"
                      : "border-[#383a40]/60 hover:border-[#4e5058]"
                  }`}
                >
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
                      {vs.self_deaf ? (
                        <Headphones className="w-3.5 h-3.5 text-[#f23f43]" />
                      ) : vs.self_mute ? (
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
                      {isSelf && " (You)"}
                    </span>
                    {isOwner && (
                      <span title="Server Owner">
                        <Crown className="w-3.5 h-3.5 text-[#f0b232] shrink-0" />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
