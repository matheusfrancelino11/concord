import React, { useEffect, useCallback } from "react";
import { useGuildStore } from "../../stores/guildStore";
import { useChannelStore } from "../../stores/channelStore";
import { useMessageStore } from "../../stores/messageStore";
import { MessageFeed } from "../chat/MessageFeed";
import { MessageInput } from "../chat/MessageInput";
import { TypingIndicator } from "../chat/TypingIndicator";
import { MemberList } from "./MemberList";
import { VoiceChannelView } from "../voice/VoiceChannelView";
import { Hash, Volume2, Bell, Pin, Users } from "lucide-react";

interface MainContentProps {
  onOpenCreateServer: () => void;
  showMemberList?: boolean;
  onToggleMemberList?: () => void;
}

export const MainContent: React.FC<MainContentProps> = ({
  onOpenCreateServer,
  showMemberList = true,
  onToggleMemberList,
}) => {
  const { guilds, selectedGuildId, activeGuildId } = useGuildStore();
  const { channels, channelsByGuild, selectedChannelId, activeChannelId } = useChannelStore();
  const fetchMessages = useMessageStore((s) => s.fetchMessages);
  const sendMessage = useMessageStore((s) => s.sendMessage);
  const sendTyping = useMessageStore((s) => s.sendTyping);
  const clearUnread = useMessageStore((s) => s.clearUnread);

  const currentGuildId = selectedGuildId || activeGuildId;
  const currentChannelId = selectedChannelId || activeChannelId;

  const currentGuild = guilds.find((g) => g.id === currentGuildId);
  const guildChannels = currentGuildId
    ? channelsByGuild[currentGuildId] || channels || []
    : [];
  const currentChannel =
    guildChannels.find((c) => c.id === currentChannelId) || guildChannels[0];

  // Fetch messages and clear unread whenever channel changes
  useEffect(() => {
    if (currentChannel && currentChannel.type === 0) {
      fetchMessages(currentChannel.id);
      clearUnread(currentChannel.id);
    }
  }, [currentChannel?.id, currentChannel?.type, fetchMessages, clearUnread]);

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!currentChannel) return;
      await sendMessage(currentChannel.id, content);
    },
    [currentChannel, sendMessage]
  );

  const handleTyping = useCallback(() => {
    if (!currentChannel) return;
    sendTyping(currentChannel.id);
  }, [currentChannel, sendTyping]);

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
                ? "Voice Channel (LiveKit SFU Audio)"
                : "Welcome to the beginning of this channel!")}
          </span>
        </div>

        <div className="flex items-center gap-3 text-[#b5bac1]">
          <Bell className="w-5 h-5 hover:text-white cursor-pointer transition" />
          <Pin className="w-5 h-5 hover:text-white cursor-pointer transition" />
          <button
            type="button"
            onClick={onToggleMemberList}
            title={showMemberList ? "Hide Member List" : "Show Member List"}
            className={`p-1 rounded hover:bg-[#35373c] transition cursor-pointer ${
              showMemberList ? "text-white" : "text-[#b5bac1] hover:text-white"
            }`}
          >
            <Users className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* 2. Channel Body + MemberList Layout */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {isVoice && currentChannel ? (
            <VoiceChannelView channel={currentChannel} />
          ) : currentChannel ? (
            <>
              <MessageFeed
                channelId={currentChannel.id}
                channelName={currentChannel.name}
              />
              <TypingIndicator channelId={currentChannel.id} />
              <MessageInput
                channelId={currentChannel.id}
                channelName={currentChannel.name}
                onSendMessage={handleSendMessage}
                onTyping={handleTyping}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[#949ba4]">
              <p>No channel selected.</p>
            </div>
          )}
        </div>

        {/* 3. Right Sidebar: Member List */}
        {showMemberList && currentGuild && (
          <MemberList guildId={currentGuild.id} />
        )}
      </div>
    </main>
  );
};
