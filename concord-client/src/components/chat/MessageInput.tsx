import React, { useState, useRef, useEffect, useCallback } from "react";
import { PlusCircle, Gift, Image as ImageIcon, Smile, Send } from "lucide-react";

interface MessageInputProps {
  channelId: string;
  channelName: string;
  onSendMessage: (content: string) => Promise<void>;
  onTyping: () => void;
  disabled?: boolean;
}

export const MessageInput: React.FC<MessageInputProps> = ({
  channelName,
  onSendMessage,
  onTyping,
  disabled = false,
}) => {
  const [content, setContent] = useState("");
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingSentRef = useRef<number>(0);

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(Math.max(el.scrollHeight, 44), 144);
    el.style.height = `${nextHeight}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [content, adjustHeight]);

  const handleTypingTrigger = useCallback(() => {
    const now = Date.now();
    // Debounce/throttle to at most once every 3,000 ms
    if (now - lastTypingSentRef.current > 3000) {
      lastTypingSentRef.current = now;
      onTyping();
    }
  }, [onTyping]);

  const handleSend = async () => {
    const trimmed = content.trim();
    if (!trimmed || isSending || disabled) return;

    try {
      setIsSending(true);
      await onSendMessage(trimmed);
      setContent("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "44px";
        textareaRef.current.focus();
      }
    } catch (err: unknown) {
      console.error("[MessageInput] Send error:", err);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else {
      handleTypingTrigger();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    handleTypingTrigger();
  };

  return (
    <div className="px-4 pb-6 pt-1 select-none">
      <div className="bg-[#383a40] rounded-lg px-4 py-2.5 flex items-end gap-3 focus-within:ring-1 focus-within:ring-[#5865F2] transition shadow-inner">
        {/* Attachment Button */}
        <button
          type="button"
          aria-label="Add attachment"
          className="text-[#b5bac1] hover:text-[#f2f3f5] p-1 -ml-1 rounded-full hover:bg-[#404249] transition cursor-pointer shrink-0 mb-0.5"
          disabled={disabled}
        >
          <PlusCircle className="w-5 h-5" />
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={`Message #${channelName || "channel"}`}
          disabled={disabled || isSending}
          rows={1}
          className="flex-1 bg-transparent text-[#dbdee1] placeholder-[#80848e] text-sm focus:outline-none resize-none max-h-[144px] overflow-y-auto leading-relaxed py-1"
        />

        {/* Action icons & Send button */}
        <div className="flex items-center gap-2 text-[#b5bac1] shrink-0 mb-0.5">
          <button
            type="button"
            aria-label="Gift Nitro"
            className="hover:text-[#f2f3f5] p-1 rounded hover:bg-[#404249] transition cursor-pointer hidden sm:block"
          >
            <Gift className="w-5 h-5" />
          </button>
          <button
            type="button"
            aria-label="GIF"
            className="hover:text-[#f2f3f5] p-1 rounded hover:bg-[#404249] transition cursor-pointer hidden sm:block"
          >
            <ImageIcon className="w-5 h-5" />
          </button>
          <button
            type="button"
            aria-label="Emoji"
            className="hover:text-[#f2f3f5] p-1 rounded hover:bg-[#404249] transition cursor-pointer"
          >
            <Smile className="w-5 h-5" />
          </button>
          {content.trim().length > 0 && (
            <button
              type="button"
              onClick={handleSend}
              disabled={isSending || disabled}
              aria-label="Send message"
              className="text-[#5865F2] hover:text-[#4752c4] p-1 rounded hover:bg-[#404249] transition cursor-pointer disabled:opacity-50"
            >
              <Send className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
