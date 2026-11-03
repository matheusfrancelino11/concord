import React, { useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { useMessageStore } from "../../stores/messageStore";
import { useAuthStore } from "../../stores/authStore";
import { useGuildStore } from "../../stores/guildStore";
import { Message } from "../../types";
import { MessageItem } from "./MessageItem";
import { Hash, Loader2 } from "lucide-react";

const EMPTY_MESSAGES: Message[] = [];

interface MessageFeedProps {
  channelId: string;
  channelName: string;
  onReply?: (message: Message) => void;
  searchQuery?: string;
}

export const MessageFeed: React.FC<MessageFeedProps> = ({
  channelId,
  channelName,
  onReply,
  searchQuery,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef<boolean>(true);
  const prevScrollHeightRef = useRef<number | null>(null);
  const isPagingOlderRef = useRef<boolean>(false);

  const { user } = useAuthStore();
  const { guilds, selectedGuildId, activeGuildId } = useGuildStore();
  const currentGuildId = selectedGuildId || activeGuildId;
  const currentGuild = guilds.find((g) => g.id === currentGuildId);

  const rawMessages = useMessageStore((state) => state.messagesByChannel[channelId]);
  const messages = rawMessages ?? EMPTY_MESSAGES;
  const isLoading = useMessageStore((state) => state.isLoadingByChannel[channelId] || false);
  const isLoadingOlder = useMessageStore((state) => state.isLoadingOlderByChannel[channelId] || false);
  const hasMore = useMessageStore((state) => state.hasMoreByChannel[channelId] ?? true);

  const fetchOlderMessages = useMessageStore((state) => state.fetchOlderMessages);
  const editMessage = useMessageStore((state) => state.editMessage);
  const deleteMessage = useMessageStore((state) => state.deleteMessage);

  // Check scroll position to determine if pinned to bottom
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 120;

    // Detect top-scroll infinite paging
    if (el.scrollTop <= 10 && !isLoadingOlder && hasMore && !isPagingOlderRef.current && messages.length > 0) {
      isPagingOlderRef.current = true;
      prevScrollHeightRef.current = el.scrollHeight;

      fetchOlderMessages(channelId).finally(() => {
        isPagingOlderRef.current = false;
      });
    }
  }, [channelId, isLoadingOlder, hasMore, messages.length, fetchOlderMessages]);

  // Adjust scroll offset after older messages are prepended to prevent jump
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (el && prevScrollHeightRef.current !== null) {
      const heightDifference = el.scrollHeight - prevScrollHeightRef.current;
      if (heightDifference > 0) {
        el.scrollTop += heightDifference;
      }
      prevScrollHeightRef.current = null;
    }
  }, [messages]);

  // Auto-scroll to bottom on new messages if near bottom
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    // If user is near bottom, scroll down to reveal new message
    if (isNearBottomRef.current && prevScrollHeightRef.current === null) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Scroll to bottom on initial channel switch
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      isNearBottomRef.current = true;
    }
  }, [channelId]);

  const handleEdit = useCallback(
    async (messageId: string, content: string) => {
      await editMessage(channelId, messageId, content);
    },
    [channelId, editMessage]
  );

  const handleDelete = useCallback(
    async (messageId: string) => {
      await deleteMessage(channelId, messageId);
    },
    [channelId, deleteMessage]
  );

  if (isLoading && messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-[#949ba4] gap-2 select-none">
        <Loader2 className="w-8 h-8 animate-spin text-[#5865F2]" />
        <span className="text-sm font-medium">Carregando mensagens...</span>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-2 select-none flex flex-col"
    >
      {/* 1. Loading Older Spinner */}
      {isLoadingOlder && (
        <div className="py-2 flex items-center justify-center text-[#949ba4] gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-[#5865F2]" />
          <span className="text-xs">Carregando mensagens anteriores...</span>
        </div>
      )}

      {/* 2. Top Channel Welcome Banner when at inception */}
      {!hasMore && (
        <div className="pt-4 pb-6 px-4">
          <div className="w-16 h-16 rounded-full bg-[#404249] flex items-center justify-center text-white mb-2">
            <Hash className="w-10 h-10" />
          </div>
          <h2 className="text-3xl font-bold text-[#f2f3f5]">
            Boas-vindas ao #{channelName || "geral"}!
          </h2>
          <p className="text-sm text-[#949ba4] mt-1">
            Este é o início do canal #{channelName || "geral"}.
          </p>
        </div>
      )}

      {/* Spacer to push messages down if few messages */}
      <div className="flex-1" />

      {/* 3. Message List */}
      <div className="space-y-1">
        {(searchQuery
          ? messages.filter((m) =>
              m.content.toLowerCase().includes(searchQuery.toLowerCase())
            )
          : messages
        ).map((message) => {
          const isAuthor = Boolean(
            user &&
              (message.author?.id === user.id ||
                message.author_id === user.id)
          );
          const isGuildOwner = Boolean(
            user && currentGuild && currentGuild.owner_id === user.id
          );
          const canDelete = isAuthor || isGuildOwner;
          const replyMessage = message.reply_to_id
            ? messages.find((m) => m.id === message.reply_to_id) || null
            : null;

          return (
            <MessageItem
              key={message.id}
              message={message}
              isAuthor={isAuthor}
              canDelete={canDelete}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onReply={onReply}
              replyMessage={replyMessage}
            />
          );
        })}
      </div>
    </div>
  );
};
