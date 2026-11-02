import React, { useState, useRef, useEffect } from "react";
import { Message } from "../../types";
import { Pencil, Trash2, Check, X } from "lucide-react";

interface MessageItemProps {
  message: Message;
  isAuthor: boolean;
  canDelete: boolean;
  onEdit: (messageId: string, content: string) => Promise<void>;
  onDelete: (messageId: string) => Promise<void>;
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
      return `Today at ${timeStr}`;
    } else if (isYesterday) {
      return `Yesterday at ${timeStr}`;
    } else {
      return `${date.toLocaleDateString()} ${timeStr}`;
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

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  isAuthor,
  canDelete,
  onEdit,
  onDelete,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [isSaving, setIsSaving] = useState(false);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const authorName =
    message.author?.global_name || message.author?.username || "Unknown User";
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
      const msg = err instanceof Error ? err.message : "Failed to edit message";
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
    if (window.confirm("Are you sure you want to delete this message?")) {
      try {
        await onDelete(message.id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to delete message";
        alert(msg);
      }
    }
  };

  return (
    <div className="group relative flex items-start gap-4 px-4 py-1.5 hover:bg-[#2e3035]/60 rounded transition-colors select-text">
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
                escape to{" "}
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="text-[#00a8fc] hover:underline"
                >
                  cancel
                </button>{" "}
                • enter to{" "}
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="text-[#00a8fc] hover:underline"
                >
                  save
                </button>
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-2 py-1 bg-[#4e5058] hover:bg-[#6d6f78] text-white rounded text-xs flex items-center gap-1"
                >
                  <X className="w-3 h-3" /> Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={isSaving || !editContent.trim()}
                  className="px-2 py-1 bg-[#5865F2] hover:bg-[#4752c4] text-white rounded text-xs flex items-center gap-1 disabled:opacity-50"
                >
                  <Check className="w-3 h-3" /> Save
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-[15px] text-[#dbdee1] leading-relaxed whitespace-pre-wrap break-words mt-0.5">
            {message.content}
            {message.edited_at && (
              <span className="text-[10px] text-[#949ba4] ml-1.5 select-none font-medium">
                (edited)
              </span>
            )}
          </div>
        )}
      </div>

      {/* 3. Floating Action Bar on Hover */}
      {!isEditing && (isAuthor || canDelete) && (
        <div className="absolute right-4 -top-3 hidden group-hover:flex items-center bg-[#313338] border border-[#232428] rounded shadow-md z-10 select-none">
          {isAuthor && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              title="Edit Message"
              aria-label="Edit Message"
              className="p-1.5 text-[#b5bac1] hover:text-[#f2f3f5] hover:bg-[#35373c] rounded-l transition cursor-pointer"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={handleDelete}
              title="Delete Message"
              aria-label="Delete Message"
              className={`p-1.5 text-[#b5bac1] hover:text-[#f23f43] hover:bg-[#35373c] transition cursor-pointer ${
                isAuthor ? "rounded-r" : "rounded"
              }`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
