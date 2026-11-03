import React, { useEffect, useCallback, useState } from "react";
import { useGuildStore } from "../../stores/guildStore";
import { useChannelStore } from "../../stores/channelStore";
import { useMessageStore } from "../../stores/messageStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { MessageFeed } from "../chat/MessageFeed";
import { MessageInput } from "../chat/MessageInput";
import { TypingIndicator } from "../chat/TypingIndicator";
import { MemberList } from "./MemberList";
import { VoiceChannelView } from "../voice/VoiceChannelView";
import { Message } from "../../types";
import { Hash, Volume2, Bell, BellOff, Pin, Users, Search, X } from "lucide-react";

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

  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const mutedChannels = useSettingsStore((s) => s.mutedChannels);
  const toggleMuteChannel = useSettingsStore((s) => s.toggleMuteChannel);

  // Fetch messages and clear unread whenever channel changes
  useEffect(() => {
    if (currentChannel && currentChannel.type === 0) {
      fetchMessages(currentChannel.id);
      clearUnread(currentChannel.id);
      setReplyingTo(null);
      setSearchQuery("");
    }
  }, [currentChannel?.id, currentChannel?.type, fetchMessages, clearUnread]);

  const handleSendMessage = useCallback(
    async (content: string, replyToId?: string) => {
      if (!currentChannel) return;
      await sendMessage(currentChannel.id, content, replyToId);
      setReplyingTo(null);
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
          {/* Search box for messages */}
          <div className="relative flex items-center">
            {showSearch ? (
              <div className="flex items-center bg-[#1e1f22] rounded px-2 py-1 border border-[#1f2023] animate-in fade-in-0">
                <Search className="w-3.5 h-3.5 text-[#949ba4] mr-1.5 shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar mensagens..."
                  autoFocus
                  className="bg-transparent text-xs text-white focus:outline-none w-36 sm:w-48 placeholder-[#80848e]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="p-0.5 hover:text-white cursor-pointer"
                  >
                    <X className="w-3 h-3 text-[#949ba4]" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setShowSearch(false);
                    setSearchQuery("");
                  }}
                  className="ml-1 text-[11px] text-[#949ba4] hover:text-white cursor-pointer"
                >
                  ESC
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowSearch(true)}
                title="Buscar mensagens no canal"
                className="p-1 hover:text-white hover:bg-[#35373c] rounded transition cursor-pointer"
              >
                <Search className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Mute Channel Button */}
          {currentChannel && (
            <button
              type="button"
              onClick={() => toggleMuteChannel(currentChannel.id)}
              title={
                mutedChannels[currentChannel.id]
                  ? "Desmutar canal"
                  : "Silenciar notificações do canal"
              }
              className={`p-1 rounded hover:bg-[#35373c] transition cursor-pointer ${
                mutedChannels[currentChannel.id]
                  ? "text-[#f23f43]"
                  : "hover:text-white"
              }`}
            >
              {mutedChannels[currentChannel.id] ? (
                <BellOff className="w-4 h-4" />
              ) : (
                <Bell className="w-4 h-4" />
              )}
            </button>
          )}

          <Pin className="w-4 h-4 hover:text-white cursor-pointer transition hidden sm:block" />
          <button
            type="button"
            onClick={onToggleMemberList}
            title={showMemberList ? "Hide Member List" : "Show Member List"}
            className={`p-1 rounded hover:bg-[#35373c] transition cursor-pointer ${
              showMemberList ? "text-white" : "text-[#b5bac1] hover:text-white"
            }`}
          >
            <Users className="w-4 h-4" />
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
                onReply={setReplyingTo}
                searchQuery={searchQuery}
              />
              <TypingIndicator channelId={currentChannel.id} />
              <MessageInput
                channelId={currentChannel.id}
                channelName={currentChannel.name}
                onSendMessage={handleSendMessage}
                onTyping={handleTyping}
                replyingTo={replyingTo}
                onCancelReply={() => setReplyingTo(null)}
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
