import React, { useState, useRef, useEffect, useCallback } from "react";
import { Message } from "../../types";
import { PlusCircle, Gift, Image as ImageIcon, Smile, Send, X, CornerDownRight } from "lucide-react";

interface MessageInputProps {
  channelId: string;
  channelName: string;
  onSendMessage: (content: string, replyToId?: string) => Promise<void>;
  onTyping: () => void;
  disabled?: boolean;
  replyingTo?: Message | null;
  onCancelReply?: () => void;
}

const EMOJI_PALETTE = ["😄", "😂", "🥰", "😎", "👍", "🔥", "🎉", "❤️", "🚀", "✨", "👀", "🙌"];

export const MessageInput: React.FC<MessageInputProps> = ({
  channelName,
  onSendMessage,
  onTyping,
  disabled = false,
  replyingTo = null,
  onCancelReply,
}) => {
  const [content, setContent] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
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

  // Focus textarea when replyingTo changes
  useEffect(() => {
    if (replyingTo && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [replyingTo]);

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
      await onSendMessage(trimmed, replyingTo?.id);
      setContent("");
      if (onCancelReply) {
        onCancelReply();
      }
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
    } else if (e.key === "Escape" && replyingTo && onCancelReply) {
      e.preventDefault();
      onCancelReply();
    } else {
      handleTypingTrigger();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    handleTypingTrigger();
  };

  const handleInsertEmoji = (emoji: string) => {
    setContent((prev) => prev + emoji);
    setShowEmojiPicker(false);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleAddAttachment = () => {
    const url = prompt("Insira o link da imagem (.png, .jpg, .gif, .webp):");
    if (url && url.trim()) {
      setContent((prev) => (prev ? `${prev} ${url.trim()}` : url.trim()));
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }
  };

  const replyAuthor =
    replyingTo?.author?.global_name || replyingTo?.author?.username || "usuário";

  return (
    <div className="px-4 pb-6 pt-1 select-none">
      {/* Reply Banner Above Input */}
      {replyingTo && (
        <div className="bg-[#2b2d31] rounded-t-lg px-4 py-1.5 flex items-center justify-between border-b border-[#383a40] text-xs text-[#b5bac1] animate-in fade-in-50">
          <div className="flex items-center gap-2 truncate">
            <CornerDownRight className="w-3.5 h-3.5 text-[#5865F2] shrink-0" />
            <span>
              Respondendo a <strong className="text-white">@{replyAuthor}</strong>
            </span>
            <span className="truncate max-w-sm text-[#949ba4] italic">
              "{replyingTo.content}"
            </span>
          </div>
          {onCancelReply && (
            <button
              type="button"
              onClick={onCancelReply}
              title="Cancelar resposta (ESC)"
              className="p-1 hover:text-white rounded hover:bg-[#35373c] transition cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Main Input Box */}
      <div
        className={`bg-[#383a40] px-4 py-2.5 flex items-end gap-3 focus-within:ring-1 focus-within:ring-[#5865F2] transition shadow-inner ${
          replyingTo ? "rounded-b-lg" : "rounded-lg"
        }`}
      >
        {/* Attachment Button */}
        <button
          type="button"
          onClick={handleAddAttachment}
          aria-label="Adicionar link de imagem"
          title="Adicionar link de imagem"
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
          placeholder={`Conversar em #${channelName || "canal"}`}
          disabled={disabled || isSending}
          rows={1}
          className="flex-1 bg-transparent text-[#dbdee1] placeholder-[#80848e] text-sm focus:outline-none resize-none max-h-[144px] overflow-y-auto leading-relaxed py-1"
        />

        {/* Action icons & Send button */}
        <div className="flex items-center gap-2 text-[#b5bac1] shrink-0 mb-0.5 relative">
          <button
            type="button"
            onClick={handleAddAttachment}
            aria-label="GIF / Imagem"
            title="Inserir imagem"
            className="hover:text-[#f2f3f5] p-1 rounded hover:bg-[#404249] transition cursor-pointer hidden sm:block"
          >
            <ImageIcon className="w-5 h-5" />
          </button>

          {/* Emoji Palette Button */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              aria-label="Emoji"
              title="Inserir emoji"
              className="hover:text-[#f2f3f5] p-1 rounded hover:bg-[#404249] transition cursor-pointer"
            >
              <Smile className="w-5 h-5" />
            </button>

            {/* Emoji Palette Popover */}
            {showEmojiPicker && (
              <div className="absolute bottom-10 right-0 bg-[#111214] border border-[#2b2d31] p-2 rounded-lg shadow-2xl grid grid-cols-4 gap-1.5 z-30 animate-in fade-in-0 w-44">
                {EMOJI_PALETTE.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleInsertEmoji(emoji)}
                    className="p-1.5 hover:bg-[#35373c] rounded text-lg hover:scale-125 transition transform cursor-pointer flex items-center justify-center"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>

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
