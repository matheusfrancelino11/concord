import React, { useState, useRef, useEffect } from "react";
import { Message } from "../../types";
import { Pencil, Trash2, Check, X, Reply, Copy, Smile, CornerDownRight } from "lucide-react";

interface MessageItemProps {
  message: Message;
  isAuthor: boolean;
  canDelete: boolean;
  onEdit: (messageId: string, content: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
  onReply?: (message: Message) => void;
  replyMessage?: Message | null;
}

function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "";

    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear();

    const timeStr = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    if (isToday) {
      return `Hoje às ${timeStr}`;
    } else if (isYesterday) {
      return `Ontem às ${timeStr}`;
    } else {
      return `${date.toLocaleDateString("pt-BR")} ${timeStr}`;
    }
  } catch {
    return "";
  }
}

const AVATAR_COLORS = [
  "bg-[#5865F2]",
  "bg-[#57F287]",
  "bg-[#FEE75C]",
  "bg-[#EB459E]",
  "bg-[#ED4245]",
  "bg-[#00A8FC]",
];

function getAvatarColor(identifier: string): string {
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = identifier.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "🔥", "🚀", "👀"];
const IMAGE_URL_REGEX = /(https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp)(?:\?[^\s]*)?)/gi;

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  isAuthor,
  canDelete,
  onEdit,
  onDelete,
  onReply,
  replyMessage,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [isSaving, setIsSaving] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [localReactions, setLocalReactions] = useState<Record<string, number>>({});
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const authorName =
    message.author?.global_name || message.author?.username || "Usuário desconhecido";
  const initial = authorName.charAt(0).toUpperCase() || "?";
  const avatarBg = getAvatarColor(message.author?.id || authorName);

  useEffect(() => {
    if (isEditing) {
      setEditContent(message.content);
      if (editTextareaRef.current) {
        editTextareaRef.current.focus();
        editTextareaRef.current.selectionStart = editTextareaRef.current.value.length;
        editTextareaRef.current.selectionEnd = editTextareaRef.current.value.length;
      }
    }
  }, [isEditing, message.content]);

  const handleSaveEdit = async () => {
    const trimmed = editContent.trim();
    if (!trimmed || isSaving) return;

    if (trimmed === message.content) {
      setIsEditing(false);
      return;
    }

    try {
      setIsSaving(true);
      await onEdit(message.id, trimmed);
      setIsEditing(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Falha ao editar mensagem";
      alert(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsEditing(false);
      setEditContent(message.content);
    }
  };

  const handleDelete = async () => {
    if (window.confirm("Tem certeza que deseja excluir esta mensagem?")) {
      try {
        await onDelete(message.id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Falha ao excluir mensagem";
        alert(msg);
      }
    }
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(message.content);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleAddReaction = (emoji: string) => {
    setLocalReactions((prev) => {
      const current = prev[emoji] || 0;
      return {
        ...prev,
        [emoji]: current + 1,
      };
    });
    setShowEmojiPicker(false);
  };

  // Find image URLs embedded in the message
  const imageUrls = Array.from(message.content.matchAll(IMAGE_URL_REGEX)).map((m) => m[0]);
  const textWithoutImages = message.content.replace(IMAGE_URL_REGEX, "").trim();

  // Render message content with formatted mentions
  const renderFormattedContent = (text: string) => {
    const parts = text.split(/(@[\w.-]+)/g);
    return parts.map((part, idx) => {
      if (part.startsWith("@") && part.length > 1) {
        return (
          <span
            key={idx}
            className="bg-[#5865F2]/20 hover:bg-[#5865F2]/40 text-[#c9cdfb] font-semibold px-1 py-0.5 rounded cursor-pointer transition-colors"
          >
            {part}
          </span>
        );
      }
      return part;
    });
  };

  return (
    <div className="group relative flex flex-col px-4 py-1.5 hover:bg-[#2e3035]/60 rounded transition-colors select-text">
      {/* 0. Quoted Reply Header if this message is a reply */}
      {message.reply_to_id && (
        <div className="flex items-center gap-2 text-xs text-[#949ba4] mb-1 pl-7 relative select-none">
          <CornerDownRight className="w-3.5 h-3.5 text-[#949ba4] shrink-0" />
          <span className="font-semibold text-[#dbdee1]">
            @{replyMessage?.author?.global_name || replyMessage?.author?.username || "usuário"}
          </span>
          <span className="truncate max-w-md text-[#949ba4] italic">
            {replyMessage ? replyMessage.content : "Mensagem original"}
          </span>
        </div>
      )}

      <div className="flex items-start gap-4">
        {/* 1. Author Avatar */}
        <div className="shrink-0 mt-0.5">
          {message.author?.avatar ? (
            <img
              src={message.author.avatar}
              alt={authorName}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-base ${avatarBg}`}
            >
              {initial}
            </div>
          )}
        </div>

        {/* 2. Message Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-[15px] text-[#f2f3f5] hover:underline cursor-pointer">
              {authorName}
            </span>
            <span className="text-[11px] text-[#949ba4] font-medium select-none">
              {formatTimestamp(message.created_at)}
            </span>
          </div>

          {/* Content or Edit Mode */}
          {isEditing ? (
            <div className="mt-1">
              <textarea
                ref={editTextareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isSaving}
                rows={2}
                className="w-full bg-[#383a40] text-[#dbdee1] rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#5865F2] resize-none"
              />
              <div className="flex items-center justify-between text-xs text-[#949ba4] mt-1 select-none">
                <span>
                  ESC para{" "}
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="text-[#00a8fc] hover:underline cursor-pointer"
                  >
                    cancelar
                  </button>{" "}
                  • ENTER para{" "}
                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    className="text-[#00a8fc] hover:underline cursor-pointer"
                  >
                    salvar
                  </button>
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-2 py-1 bg-[#4e5058] hover:bg-[#6d6f78] text-white rounded text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <X className="w-3 h-3" /> Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    disabled={isSaving || !editContent.trim()}
                    className="px-2 py-1 bg-[#5865F2] hover:bg-[#4752c4] text-white rounded text-xs flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                  >
                    <Check className="w-3 h-3" /> Salvar
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-[15px] text-[#dbdee1] leading-relaxed whitespace-pre-wrap break-words mt-0.5">
              {textWithoutImages
                ? renderFormattedContent(textWithoutImages)
                : imageUrls.length === 0
                ? renderFormattedContent(message.content)
                : null}
              {message.edited_at && (
                <span className="text-[10px] text-[#949ba4] ml-1.5 select-none font-medium">
                  (editado)
                </span>
              )}
            </div>
          )}

          {/* Image Embeds / Previews */}
          {imageUrls.length > 0 && (
            <div className="mt-2 space-y-2">
              {imageUrls.map((url, i) => (
                <div key={i} className="max-w-md rounded-lg overflow-hidden border border-[#2b2d31] bg-black/30">
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={url}
                      alt="Anexo de imagem"
                      loading="lazy"
                      className="max-h-72 w-auto object-contain rounded hover:opacity-95 transition cursor-pointer"
                    />
                  </a>
                </div>
              ))}
            </div>
          )}

          {/* Emoji Reactions List */}
          {Object.keys(localReactions).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2 select-none">
              {Object.entries(localReactions).map(([emoji, count]) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => handleAddReaction(emoji)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#2b2d31] hover:bg-[#35373c] text-xs border border-[#383a40] text-[#dbdee1] transition cursor-pointer"
                >
                  <span>{emoji}</span>
                  <span className="font-bold text-[11px] text-[#949ba4]">{count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3. Floating Action Bar on Hover */}
      {!isEditing && (
        <div className="absolute right-4 -top-3 hidden group-hover:flex items-center bg-[#313338] border border-[#232428] rounded shadow-md z-10 select-none">
          {/* Reaction Picker Button */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              title="Adicionar Reação"
              aria-label="Adicionar Reação"
              className="p-1.5 text-[#b5bac1] hover:text-[#f2f3f5] hover:bg-[#35373c] rounded-l transition cursor-pointer"
            >
              <Smile className="w-4 h-4" />
            </button>

            {/* Quick Emoji Toolbar Popover */}
            {showEmojiPicker && (
              <div className="absolute top-8 right-0 bg-[#111214] border border-[#2b2d31] p-1.5 rounded-lg shadow-2xl flex items-center gap-1 z-30 animate-in fade-in-0">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleAddReaction(emoji)}
                    className="p-1.5 hover:bg-[#35373c] rounded text-base hover:scale-125 transition transform cursor-pointer"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Reply Button */}
          {onReply && (
            <button
              type="button"
              onClick={() => onReply(message)}
              title="Responder"
              aria-label="Responder"
              className="p-1.5 text-[#b5bac1] hover:text-[#f2f3f5] hover:bg-[#35373c] transition cursor-pointer"
            >
              <Reply className="w-4 h-4" />
            </button>
          )}

          {/* Copy Message Text */}
          <button
            type="button"
            onClick={handleCopyText}
            title={isCopied ? "Copiado!" : "Copiar Texto"}
            aria-label="Copiar Texto"
            className="p-1.5 text-[#b5bac1] hover:text-[#f2f3f5] hover:bg-[#35373c] transition cursor-pointer"
          >
            {isCopied ? <Check className="w-4 h-4 text-[#23a55a]" /> : <Copy className="w-4 h-4" />}
          </button>

          {/* Edit Message Button */}
          {isAuthor && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              title="Editar Mensagem"
              aria-label="Editar Mensagem"
              className="p-1.5 text-[#b5bac1] hover:text-[#f2f3f5] hover:bg-[#35373c] transition cursor-pointer"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}

          {/* Delete Message Button */}
          {canDelete && (
            <button
              type="button"
              onClick={handleDelete}
              title="Excluir Mensagem"
              aria-label="Excluir Mensagem"
              className="p-1.5 text-[#b5bac1] hover:text-[#f23f43] hover:bg-[#35373c] rounded-r transition cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
