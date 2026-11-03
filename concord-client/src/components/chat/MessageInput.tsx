import React, { useState, useRef, useEffect, useCallback } from "react";
import { Message } from "../../types";
import { api } from "../../api/client";
import { PlusCircle, Image as ImageIcon, Smile, Send, X, CornerDownRight, Loader2 } from "lucide-react";

interface MessageInputProps {
  channelId: string;
  channelName: string;
  onSendMessage: (content: string, replyToId?: string) => Promise<void>;
  onTyping: () => void;
  disabled?: boolean;
  replyingTo?: Message | null;
  onCancelReply?: () => void;
}

interface PendingImage {
  file: File;
  previewUrl: string;
}

const EMOJI_PALETTE = ["😄", "😂", "🥰", "😎", "👍", "🔥", "🎉", "❤️", "🚀", "✨", "👀", "🙌"];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const handleSetPendingImage = (file: File) => {
    // If a previous preview exists, revoke its URL to avoid memory leak
    if (pendingImage?.previewUrl) {
      URL.revokeObjectURL(pendingImage.previewUrl);
    }
    const previewUrl = URL.createObjectURL(file);
    setPendingImage({ file, previewUrl });
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleRemovePendingImage = () => {
    if (pendingImage?.previewUrl) {
      URL.revokeObjectURL(pendingImage.previewUrl);
    }
    setPendingImage(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleSetPendingImage(file);
      e.target.value = "";
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          const ext = item.type.split("/")[1] || "png";
          const namedFile =
            file.name && file.name !== "image.png"
              ? file
              : new File([file], `imagem-colada-${Date.now()}.${ext}`, { type: file.type });
          handleSetPendingImage(namedFile);
          return;
        }
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      handleSetPendingImage(file);
    }
  };

  const handleSend = async () => {
    const trimmed = content.trim();
    if ((!trimmed && !pendingImage) || isSending || disabled) return;

    try {
      setIsSending(true);
      let messageContent = trimmed;

      if (pendingImage) {
        // Upload image to backend
        const uploaded = await api.uploads.upload(pendingImage.file);
        messageContent = trimmed ? `${trimmed} ${uploaded.url}` : uploaded.url;
        handleRemovePendingImage();
      }

      await onSendMessage(messageContent, replyingTo?.id);
      setContent("");
      if (onCancelReply) {
        onCancelReply();
      }
      if (textareaRef.current) {
        textareaRef.current.style.height = "44px";
        textareaRef.current.focus();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Falha ao enviar mensagem";
      alert(msg);
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

  const replyAuthor =
    replyingTo?.author?.global_name || replyingTo?.author?.username || "usuário";

  const hasContentToSend = content.trim().length > 0 || pendingImage !== null;

  return (
    <div
      className="px-4 pb-6 pt-1 select-none"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Hidden File Input for Image Selection */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={handleFileSelect}
        className="hidden"
      />

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

      {/* Pending Image Attachment Preview Banner */}
      {pendingImage && (
        <div
          className={`bg-[#2b2d31] px-4 py-2 flex items-center justify-between border-b border-[#383a40] text-xs text-[#b5bac1] animate-in fade-in-50 ${
            !replyingTo ? "rounded-t-lg" : ""
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative w-12 h-12 rounded overflow-hidden bg-black/40 border border-[#3f4147] shrink-0">
              <img
                src={pendingImage.previewUrl}
                alt="Prévia do anexo"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-semibold text-white truncate max-w-[200px] sm:max-w-xs">
                {pendingImage.file.name}
              </span>
              <span className="text-[11px] text-[#949ba4]">
                {formatFileSize(pendingImage.file.size)}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRemovePendingImage}
            title="Remover imagem"
            className="p-1.5 hover:text-white rounded hover:bg-[#35373c] text-[#949ba4] transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Input Box */}
      <div
        className={`bg-[#383a40] px-4 py-2.5 flex items-end gap-3 focus-within:ring-1 focus-within:ring-[#5865F2] transition shadow-inner ${
          replyingTo || pendingImage ? "rounded-b-lg" : "rounded-lg"
        }`}
      >
        {/* Attachment Upload Button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Enviar imagem do computador"
          title="Enviar imagem do computador (ou cole com Ctrl+V)"
          className="text-[#b5bac1] hover:text-[#f2f3f5] p-1 -ml-1 rounded-full hover:bg-[#404249] transition cursor-pointer shrink-0 mb-0.5"
          disabled={disabled || isSending}
        >
          <PlusCircle className="w-5 h-5" />
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={`Conversar em #${channelName || "canal"}`}
          disabled={disabled || isSending}
          rows={1}
          className="flex-1 bg-transparent text-[#dbdee1] placeholder-[#80848e] text-sm focus:outline-none resize-none max-h-[144px] overflow-y-auto leading-relaxed py-1"
        />

        {/* Action icons & Send button */}
        <div className="flex items-center gap-2 text-[#b5bac1] shrink-0 mb-0.5 relative">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Anexar Imagem"
            title="Anexar imagem do computador"
            className="hover:text-[#f2f3f5] p-1 rounded hover:bg-[#404249] transition cursor-pointer hidden sm:block"
            disabled={disabled || isSending}
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

          {hasContentToSend && (
            <button
              type="button"
              onClick={handleSend}
              disabled={isSending || disabled}
              aria-label="Enviar mensagem"
              title="Enviar mensagem"
              className="text-[#5865F2] hover:text-[#4752c4] p-1 rounded hover:bg-[#404249] transition cursor-pointer disabled:opacity-50"
            >
              {isSending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
