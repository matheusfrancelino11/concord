import React from "react";
import { useGuildStore } from "../../stores/guildStore";
import { useChannelStore } from "../../stores/channelStore";
import { Hash, Volume2, Bell, Pin, Users, PlusCircle, Gift, Image, Smile } from "lucide-react";

interface MainContentProps {
  onOpenCreateServer: () => void;
}

export const MainContent: React.FC<MainContentProps> = ({ onOpenCreateServer }) => {
  const { guilds, selectedGuildId, activeGuildId } = useGuildStore();
  const { channels, channelsByGuild, selectedChannelId, activeChannelId } = useChannelStore();

  const currentGuildId = selectedGuildId || activeGuildId;
  const currentChannelId = selectedChannelId || activeChannelId;

  const currentGuild = guilds.find((g) => g.id === currentGuildId);
  const guildChannels = currentGuildId
    ? channelsByGuild[currentGuildId] || channels || []
    : [];
  const currentChannel =
    guildChannels.find((c) => c.id === currentChannelId) || guildChannels[0];

  if (!currentGuild) {
    return (
      <main className="flex-1 h-full bg-[#313338] flex flex-col items-center justify-center text-center p-8 select-none">
        <div className="w-20 h-20 rounded-full bg-[#2b2d31] flex items-center justify-center text-[#5865F2] mb-4">
          <Hash className="w-10 h-10" />
        </div>
        <h2 className="text-2xl font-bold text-[#f2f3f5]">No Server Selected</h2>
        <p className="text-[#949ba4] text-sm mt-2 max-w-sm">
          Select a server from the left sidebar or create a new one to start hanging out with your friends.
        </p>
        <button
          type="button"
          onClick={onOpenCreateServer}
          className="mt-6 bg-[#5865F2] hover:bg-[#4752c4] text-white px-6 py-2.5 rounded-[3px] font-medium text-sm transition cursor-pointer"
        >
          Create a Server
        </button>
      </main>
    );
  }

  const isVoice = currentChannel?.type === 2;

  return (
    <main className="flex-1 h-full bg-[#313338] flex flex-col overflow-hidden select-none">
      {/* 1. Channel Header (48px) */}
      <header className="h-12 min-h-[48px] border-b border-[#1f2023] px-4 flex items-center justify-between shadow-sm bg-[#313338]">
        <div className="flex items-center min-w-0">
          {isVoice ? (
            <Volume2 className="w-6 h-6 text-[#80848e] mr-2 shrink-0" />
          ) : (
            <Hash className="w-6 h-6 text-[#80848e] mr-2 shrink-0" />
          )}
          <span className="font-bold text-[#f2f3f5] text-[15px] truncate">
            {currentChannel?.name || "geral"}
          </span>
          <div className="w-[1px] h-4 bg-[#3f4147] mx-3 shrink-0" />
          <span className="text-xs text-[#949ba4] truncate max-w-lg">
            {currentChannel?.topic ||
              (isVoice
                ? "Voice Channel (LiveKit audio connects in Milestone 4)"
                : "Welcome to the beginning of this channel!")}
          </span>
        </div>

        <div className="flex items-center gap-3 text-[#b5bac1]">
          <Bell className="w-5 h-5 hover:text-white cursor-pointer transition" />
          <Pin className="w-5 h-5 hover:text-white cursor-pointer transition" />
          <Users className="w-5 h-5 hover:text-white cursor-pointer transition" />
        </div>
      </header>

      {/* 2. Welcome & Chat Feed Placeholder */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col justify-end space-y-4">
        <div className="mb-4">
          <div className="w-16 h-16 rounded-full bg-[#404249] flex items-center justify-center text-white mb-2">
            {isVoice ? <Volume2 className="w-10 h-10" /> : <Hash className="w-10 h-10" />}
          </div>
          <h2 className="text-3xl font-bold text-[#f2f3f5]">
            Welcome to #{currentChannel?.name || "geral"}!
          </h2>
          <p className="text-sm text-[#949ba4] mt-1">
            This is the start of the #{currentChannel?.name || "geral"} channel.
          </p>

          {isVoice ? (
            <div className="mt-4 p-4 rounded-md bg-[#2b2d31] border border-[#383a40] text-xs text-[#dbdee1] max-w-lg">
              <span className="font-semibold text-white">🔊 Voice Channel Ready:</span> WebRTC Voice
              audio and screen sharing will be connected via LiveKit SFU in Milestone 4.
            </div>
          ) : (
            <div className="mt-4 p-4 rounded-md bg-[#2b2d31] border border-[#383a40] text-xs text-[#dbdee1] max-w-lg">
              <span className="font-semibold text-white">💬 Milestone 1 Ready:</span> Server and
              channel navigation operational. Real-time chat messages will arrive in Milestone 2.
            </div>
          )}
        </div>
      </div>

      {/* 3. Message Input Placeholder */}
      <div className="px-4 pb-6 pt-2">
        <div className="bg-[#383a40] rounded-lg px-4 py-3 flex items-center justify-between text-[#949ba4] cursor-not-allowed">
          <div className="flex items-center gap-3">
            <PlusCircle className="w-5 h-5 opacity-40" />
            <span className="text-sm opacity-60">
              Message #{currentChannel?.name || "geral"} (Messaging unlocked in Milestone 2)
            </span>
          </div>

          <div className="flex items-center gap-3 opacity-40">
            <Gift className="w-5 h-5" />
            <Image className="w-5 h-5" />
            <Smile className="w-5 h-5" />
          </div>
        </div>
      </div>
    </main>
  );
};
