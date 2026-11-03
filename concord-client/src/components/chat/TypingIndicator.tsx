import React from "react";
import { useMessageStore, TypingUser } from "../../stores/messageStore";
import { useAuthStore } from "../../stores/authStore";

const EMPTY_TYPING: TypingUser[] = [];

interface TypingIndicatorProps {
  channelId: string;
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({ channelId }) => {
  const { user } = useAuthStore();
  const rawTyping = useMessageStore((state) => state.typingByChannel[channelId]);
  const typingUsers = rawTyping ?? EMPTY_TYPING;

  // Filter out the current user so we don't say "You are typing..."
  const otherTyping = typingUsers.filter((u) => u.userId !== user?.id);

  if (otherTyping.length === 0) {
    return <div className="h-6 select-none" aria-hidden="true" />;
  }

  let text = "";
  if (otherTyping.length === 1) {
    text = `${otherTyping[0].username} está digitando...`;
  } else if (otherTyping.length === 2) {
    text = `${otherTyping[0].username} e ${otherTyping[1].username} estão digitando...`;
  } else if (otherTyping.length === 3) {
    text = `${otherTyping[0].username}, ${otherTyping[1].username} e ${otherTyping[2].username} estão digitando...`;
  } else {
    text = "Várias pessoas estão digitando...";
  }

  return (
    <div className="h-6 px-4 flex items-center gap-2 text-xs text-[#dbdee1] select-none">
      {/* 3 Animated Bouncing Dots */}
      <span className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-[#949ba4] animate-bounce [animation-delay:-0.3s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-[#949ba4] animate-bounce [animation-delay:-0.15s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-[#949ba4] animate-bounce" />
      </span>
      <span className="font-semibold text-white truncate max-w-md">{text}</span>
    </div>
  );
};
