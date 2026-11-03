import React, { useEffect, useCallback, useState } from "react";
import { useGuildStore } from "../../stores/guildStore";
import { useChannelStore } from "../../stores/channelStore";
import { useMessageStore } from "../../stores/messageStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useAuthStore } from "../../stores/authStore";
import { useDMStore } from "../../stores/dmStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { MessageFeed } from "../chat/MessageFeed";
import { MessageInput } from "../chat/MessageInput";
import { TypingIndicator } from "../chat/TypingIndicator";
import { MemberList } from "./MemberList";
import { VoiceChannelView } from "../voice/VoiceChannelView";
import { Message } from "../../types";
import { Hash, Volume2, Bell, BellOff, Pin, Users, Search, X } from "lucide-react";
import { ConcordLogo } from "../common/ConcordLogo";

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
  const { user: currentUser } = useAuthStore();
  const { guilds, selectedGuildId, activeGuildId } = useGuildStore();
  const { channels, channelsByGuild, selectedChannelId, activeChannelId } = useChannelStore();
  const { dmChannels, selectedDMChannelId, selectDMChannel, getRecipient } = useDMStore();
  const presences = usePresenceStore((s) => s.presences);

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

  const isDM = !currentGuild && Boolean(selectedDMChannelId);
  const activeChatChannelId = isDM ? (selectedDMChannelId || "") : (currentChannel?.id || "");
  const activeDMChannel = isDM
    ? dmChannels.find((c) => c.id === selectedDMChannelId)
    : undefined;
  const dmRecipient = activeDMChannel
    ? getRecipient(activeDMChannel, currentUser?.id)
    : undefined;
  const dmRecipientStatus = (dmRecipient && presences[dmRecipient.id]) || "offline";
  const dmRecipientName =
    dmRecipient?.global_name || dmRecipient?.username || "Amigo";

  // Fetch messages and clear unread whenever channel or DM changes
  useEffect(() => {
    if (activeChatChannelId && (!currentChannel || currentChannel.type === 0 || isDM)) {
      fetchMessages(activeChatChannelId);
      clearUnread(activeChatChannelId);
      setReplyingTo(null);
      setSearchQuery("");
    }
  }, [activeChatChannelId, isDM, currentChannel?.type, fetchMessages, clearUnread]);

  const handleSendMessage = useCallback(
    async (content: string, replyToId?: string) => {
      if (!activeChatChannelId) return;
      await sendMessage(activeChatChannelId, content, replyToId);
      setReplyingTo(null);
    },
    [activeChatChannelId, sendMessage]
  );

  const handleTyping = useCallback(() => {
    if (!activeChatChannelId) return;
    sendTyping(activeChatChannelId);
  }, [activeChatChannelId, sendTyping]);

  // 1. Direct Messages Chat View
  if (!currentGuild && selectedDMChannelId && activeDMChannel) {
    return (
      <main className="flex-1 h-full bg-[#313338] flex flex-col overflow-hidden select-none">
        {/* DM Channel Header (48px) */}
        <header className="h-12 min-h-[48px] border-b border-[#1f2023] px-4 flex items-center justify-between shadow-sm bg-[#313338]">
          <div className="flex items-center min-w-0 gap-2.5">
            <div className="relative shrink-0">
              <div className="w-7 h-7 rounded-full bg-[#5865F2] flex items-center justify-center text-white text-xs font-bold overflow-hidden">
                {dmRecipient?.avatar ? (
                  <img
                    src={dmRecipient.avatar}
                    alt={dmRecipientName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  dmRecipientName.slice(0, 2).toUpperCase()
                )}
              </div>
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#313338] ${
                  dmRecipientStatus === "online"
                    ? "bg-[#23a55a]"
                    : dmRecipientStatus === "idle"
                    ? "bg-[#f0b232]"
                    : dmRecipientStatus === "dnd"
                    ? "bg-[#f23f43]"
                    : "bg-[#80848e]"
                }`}
              />
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-bold text-[#f2f3f5] text-[15px] truncate">
                {dmRecipientName}
              </span>
              {dmRecipient?.global_name && dmRecipient.global_name !== dmRecipient.username && (
                <span className="text-xs text-[#949ba4] truncate">
                  @{dmRecipient.username}
                </span>
              )}
            </div>
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
                    placeholder="Buscar na conversa..."
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
                  title="Buscar mensagens na conversa"
                  className="p-1 hover:text-white hover:bg-[#35373c] rounded transition cursor-pointer"
                >
                  <Search className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </header>

        {/* DM Chat Feed & Input */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <MessageFeed
            channelId={selectedDMChannelId}
            channelName={dmRecipientName}
            onReply={setReplyingTo}
            searchQuery={searchQuery}
          />
          <TypingIndicator channelId={selectedDMChannelId} />
          <MessageInput
            channelId={selectedDMChannelId}
            channelName={dmRecipientName}
            onSendMessage={handleSendMessage}
            onTyping={handleTyping}
            replyingTo={replyingTo}
            onCancelReply={() => setReplyingTo(null)}
          />
        </div>
      </main>
    );
  }

  // 2. Direct Messages Home View (when no DM is active)
  if (!currentGuild) {
    return (
      <main className="flex-1 h-full bg-[#313338] flex flex-col items-center justify-center text-center p-8 select-none">
        <div className="w-20 h-20 rounded-full bg-[#1e1f22] flex items-center justify-center p-3 mb-4 shadow-xl border border-[#2b2d31]">
          <ConcordLogo size={52} variant="mascot" eyeColor="#1FCE66" bodyColor="#FFFFFF" />
        </div>
        <h2 className="text-2xl font-bold text-[#f2f3f5]">Mensagens Diretas</h2>
        <p className="text-[#949ba4] text-sm mt-2 max-w-md leading-relaxed">
          Converse em particular com amigos através de texto, áudio, imagens e reações com emojis.
        </p>

        {dmChannels.length > 0 ? (
          <div className="mt-6 w-full max-w-sm space-y-2">
            <div className="text-xs font-bold text-[#949ba4] uppercase tracking-wider text-left px-1">
              Conversas Recentes
            </div>
            <div className="bg-[#2b2d31] rounded-lg border border-[#1f2023] divide-y divide-[#1f2023] overflow-hidden shadow">
              {dmChannels.slice(0, 5).map((dm) => {
                const rec = getRecipient(dm, currentUser?.id);
                const name = rec?.global_name || rec?.username || "Amigo";
                const s = (rec && presences[rec.id]) || "offline";
                return (
                  <button
                    key={dm.id}
                    type="button"
                    onClick={() => selectDMChannel(dm.id)}
                    className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-[#35373c] text-left transition cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="relative shrink-0">
                        <div className="w-8 h-8 rounded-full bg-[#5865F2] flex items-center justify-center text-white text-xs font-bold overflow-hidden">
                          {rec?.avatar ? (
                            <img
                              src={rec.avatar}
                              alt={name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            name.slice(0, 2).toUpperCase()
                          )}
                        </div>
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-[#2b2d31] ${
                            s === "online"
                              ? "bg-[#23a55a]"
                              : s === "idle"
                              ? "bg-[#f0b232]"
                              : s === "dnd"
                              ? "bg-[#f23f43]"
                              : "bg-[#80848e]"
                          }`}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white truncate">{name}</div>
                        <div className="text-xs text-[#949ba4] truncate">@{rec?.username}</div>
                      </div>
                    </div>
                    <span className="text-xs text-[#1FCE66] font-medium">Conversar</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mt-6 flex flex-col items-center gap-3">
            <p className="text-xs text-[#80848e] max-w-xs">
              Para começar uma conversa direta, abra o menu de contexto (botão direito) em qualquer membro em um servidor e selecione &quot;Enviar Mensagem Direta&quot;.
            </p>
            <button
              type="button"
              onClick={onOpenCreateServer}
              className="mt-2 bg-[#5865F2] hover:bg-[#4752c4] text-white px-5 py-2 rounded-[3px] font-medium text-sm transition cursor-pointer"
            >
              Criar ou Entrar em um Servidor
            </button>
          </div>
        )}
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
