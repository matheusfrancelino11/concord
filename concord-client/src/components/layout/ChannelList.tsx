import React from "react";
import { useGuildStore } from "../../stores/guildStore";
import { useChannelStore } from "../../stores/channelStore";
import { useAuthStore } from "../../stores/authStore";
import { useMessageStore } from "../../stores/messageStore";
import { useVoiceStore } from "../../stores/voiceStore";
import { Hash, Volume2, Plus, ChevronDown, Trash2, UserPlus, Mic, MicOff, Headphones } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { UserFooter } from "./UserFooter";
import { VoiceControls } from "../voice/VoiceControls";

interface ChannelListProps {
  onOpenCreateChannel: (type: 0 | 2) => void;
  onOpenCreateServer: () => void;
  onOpenInvite?: () => void;
}

export const ChannelList: React.FC<ChannelListProps> = ({
  onOpenCreateChannel,
  onOpenCreateServer,
  onOpenInvite,
}) => {
  const { user } = useAuthStore();
  const { guilds, selectedGuildId, activeGuildId, deleteGuild } = useGuildStore();
  const { channels, channelsByGuild, selectedChannelId, activeChannelId, selectChannel, deleteChannel } = useChannelStore();
  const unreadByChannel = useMessageStore((s) => s.unreadByChannel);
  const clearUnread = useMessageStore((s) => s.clearUnread);
  const {
    voiceStatesByGuild,
    activeVoiceChannelId,
    joinVoiceChannel,
    leaveVoiceChannel,
    isUserSpeaking,
  } = useVoiceStore();

  const currentGuildId = selectedGuildId || activeGuildId;
  const currentChannelId = selectedChannelId || activeChannelId;

  const currentGuild = guilds.find((g) => g.id === currentGuildId);
  const guildChannels = currentGuildId
    ? channelsByGuild[currentGuildId] || channels || []
    : [];

  const textChannels = guildChannels.filter((c) => c.type === 0);
  const voiceChannels = guildChannels.filter((c) => c.type === 2);

  const isOwner = currentGuild && user && currentGuild.owner_id === user.id;

  const handleDeleteGuild = async () => {
    if (!currentGuild) return;
    if (window.confirm(`Are you sure you want to delete server "${currentGuild.name}"? This cannot be undone.`)) {
      try {
        await deleteGuild(currentGuild.id);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to delete server";
        alert(message);
      }
    }
  };

  const handleDeleteChannel = async (channelId: string, channelName: string) => {
    if (!currentGuildId) return;
    if (window.confirm(`Are you sure you want to delete channel #${channelName}?`)) {
      try {
        await deleteChannel(channelId, currentGuildId);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to delete channel";
        alert(message);
      }
    }
  };

  return (
    <div className="w-60 min-w-[240px] max-w-[240px] h-full bg-[#2b2d31] flex flex-col justify-between select-none z-10 border-r border-[#1f2023]/60">
      {/* 1. Guild Header */}
      <div className="h-12 min-h-[48px] border-b border-[#1f2023] px-4 flex items-center shadow-sm">
        {currentGuild ? (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="w-full flex items-center justify-between text-[15px] font-bold text-[#f2f3f5] hover:bg-[#35373c]/50 p-1.5 -mx-1.5 rounded transition cursor-pointer"
              >
                <span className="truncate">{currentGuild.name}</span>
                <ChevronDown className="w-4 h-4 text-[#949ba4] shrink-0 ml-1" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                side="bottom"
                align="start"
                sideOffset={4}
                className="w-56 bg-[#111214] border border-[#2b2d31] p-1.5 rounded-md shadow-xl text-sm font-medium z-50 text-[#dbdee1] animate-in fade-in-0 zoom-in-95"
              >
                {onOpenInvite && (
                  <DropdownMenu.Item
                    onClick={onOpenInvite}
                    className="flex items-center justify-between px-2.5 py-2 rounded text-[#5865F2] hover:bg-[#5865F2] hover:text-white cursor-pointer transition-colors outline-none font-medium"
                  >
                    <span>Invite People</span>
                    <UserPlus className="w-4 h-4" />
                  </DropdownMenu.Item>
                )}

                <DropdownMenu.Item
                  onClick={() => onOpenCreateChannel(0)}
                  className="flex items-center justify-between px-2.5 py-2 rounded text-[#949ba4] hover:bg-[#5865F2] hover:text-white cursor-pointer transition-colors outline-none"
                >
                  <span>Create Channel</span>
                  <Plus className="w-4 h-4" />
                </DropdownMenu.Item>

                {isOwner && (
                  <>
                    <DropdownMenu.Separator className="h-[1px] bg-[#2b2d31] my-1" />
                    <DropdownMenu.Item
                      onClick={handleDeleteGuild}
                      className="flex items-center justify-between px-2.5 py-2 rounded text-[#f23f43] hover:bg-[#f23f43] hover:text-white cursor-pointer transition-colors outline-none"
                    >
                      <span>Delete Server</span>
                      <Trash2 className="w-4 h-4" />
                    </DropdownMenu.Item>
                  </>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : (
          <span className="text-[15px] font-bold text-[#f2f3f5]">Direct Messages</span>
        )}
      </div>

      {/* 2. Channel Tree */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4 no-scrollbar">
        {!currentGuild ? (
          <div className="px-3 py-6 text-center text-xs text-[#949ba4]">
            <p>No server selected.</p>
            <button
              type="button"
              onClick={onOpenCreateServer}
              className="mt-3 text-[#5865F2] hover:underline block mx-auto font-medium cursor-pointer"
            >
              Create a Server
            </button>
          </div>
        ) : (
          <>
            {/* Text Channels */}
            <div>
              <div className="flex items-center justify-between px-2 pb-1 text-[12px] font-bold tracking-wider text-[#949ba4] uppercase hover:text-[#dbdee1] group">
                <span className="flex items-center gap-1">Text Channels</span>
                <button
                  type="button"
                  onClick={() => onOpenCreateChannel(0)}
                  aria-label="Create text channel"
                  className="opacity-0 group-hover:opacity-100 text-[#949ba4] hover:text-white transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-0.5">
                {textChannels.map((channel) => {
                  const isActive = channel.id === currentChannelId;
                  const unreadCount = unreadByChannel[channel.id] || 0;
                  const hasUnread = unreadCount > 0 && !isActive;

                  return (
                    <div
                      key={channel.id}
                      onClick={() => {
                        selectChannel(channel.id);
                        clearUnread(channel.id);
                      }}
                      className={`relative group flex items-center justify-between px-2 py-1.5 rounded-[4px] cursor-pointer transition-colors ${
                        isActive
                          ? "bg-[#404249] text-white font-medium"
                          : hasUnread
                          ? "text-white font-semibold hover:bg-[#35373c]"
                          : "text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]"
                      }`}
                    >
                      {/* Unread indicator pill on left */}
                      {hasUnread && (
                        <div className="w-1 h-2 bg-white rounded-r absolute -left-2" />
                      )}

                      <div className="flex items-center min-w-0">
                        <Hash
                          className={`w-5 h-5 mr-1.5 shrink-0 ${
                            isActive || hasUnread
                              ? "text-white"
                              : "text-[#80848e] group-hover:text-[#dbdee1]"
                          }`}
                        />
                        <span className="truncate text-sm">{channel.name}</span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* Unread Count Badge */}
                        {hasUnread && (
                          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-[#f23f43] text-white">
                            {unreadCount}
                          </span>
                        )}

                        {isOwner && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteChannel(channel.id, channel.name);
                            }}
                            aria-label={`Delete ${channel.name}`}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:text-[#f23f43] text-[#949ba4] transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Voice Channels */}
            <div>
              <div className="flex items-center justify-between px-2 pb-1 text-[12px] font-bold tracking-wider text-[#949ba4] uppercase hover:text-[#dbdee1] group">
                <span className="flex items-center gap-1">Voice Channels</span>
                <button
                  type="button"
                  onClick={() => onOpenCreateChannel(2)}
                  aria-label="Create voice channel"
                  className="opacity-0 group-hover:opacity-100 text-[#949ba4] hover:text-white transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-0.5">
                {voiceChannels.map((channel) => {
                  const isActive = channel.id === currentChannelId;
                  const guildVoiceStates = currentGuildId
                    ? voiceStatesByGuild[currentGuildId] || []
                    : [];
                  const connectedUsers = guildVoiceStates.filter(
                    (vs) => vs.channel_id === channel.id
                  );
                  const isInThisVoice = activeVoiceChannelId === channel.id;

                  const handleVoiceClick = () => {
                    selectChannel(channel.id);
                    if (!currentGuildId) return;
                    if (isInThisVoice) {
                      leaveVoiceChannel();
                    } else {
                      joinVoiceChannel(currentGuildId, channel.id, channel.name);
                    }
                  };

                  return (
                    <div key={channel.id} className="space-y-0.5">
                      <div
                        onClick={handleVoiceClick}
                        className={`group flex items-center justify-between px-2 py-1.5 rounded-[4px] cursor-pointer transition-colors ${
                          isActive
                            ? "bg-[#404249] text-white font-medium"
                            : "text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]"
                        }`}
                      >
                        <div className="flex items-center min-w-0">
                          <Volume2
                            className={`w-5 h-5 mr-1.5 shrink-0 ${
                              isInThisVoice
                                ? "text-[#23a55a]"
                                : "text-[#80848e] group-hover:text-[#dbdee1]"
                            }`}
                          />
                          <span className="truncate text-sm">{channel.name}</span>
                          {connectedUsers.length > 0 && (
                            <span className="ml-1.5 text-xs text-[#949ba4] font-normal">
                              ({connectedUsers.length})
                            </span>
                          )}
                        </div>
                        {isOwner && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteChannel(channel.id, channel.name);
                            }}
                            aria-label={`Delete ${channel.name}`}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:text-[#f23f43] text-[#949ba4] transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Connected Voice Members List */}
                      {connectedUsers.length > 0 && (
                        <div className="ml-6 space-y-1 py-0.5 pl-1">
                          {connectedUsers.map((vs) => {
                            const vsUser = vs.member?.user;
                            const vsName =
                              vs.member?.nick ||
                              vsUser?.global_name ||
                              vsUser?.username ||
                              "User";
                            const speaking = isUserSpeaking(vs.user_id);
                            return (
                              <div
                                key={vs.user_id}
                                className="flex items-center gap-2 py-0.5 text-xs text-[#dbdee1]"
                              >
                                <div
                                  className={`w-5 h-5 rounded-full bg-[#5865F2] flex items-center justify-center text-[10px] font-bold text-white shrink-0 overflow-hidden transition-all duration-150 ${
                                    speaking
                                      ? "ring-2 ring-[#23a55a] shadow-[0_0_8px_#23a55a]"
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
                                    vsName.charAt(0).toUpperCase()
                                  )}
                                </div>
                                <span className="truncate">{vsName}</span>
                                <div className="ml-auto shrink-0 flex items-center">
                                  {vs.self_deaf ? (
                                    <Headphones className="w-3 h-3 text-[#f23f43]" />
                                  ) : vs.self_mute ? (
                                    <MicOff className="w-3 h-3 text-[#f23f43]" />
                                  ) : speaking ? (
                                    <Mic className="w-3 h-3 text-[#23a55a]" />
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Voice Controls pinned bar */}
      <VoiceControls />

      {/* 3. User Footer */}
      <UserFooter />
    </div>
  );
};
