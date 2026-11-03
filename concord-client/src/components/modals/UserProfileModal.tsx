import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { UserSummary } from "../../types";
import { X, Calendar, Copy, Check } from "lucide-react";

interface UserProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserSummary;
  nick?: string | null;
  joinedAt?: string;
  roles?: Array<{ id: string; name: string; color: number }>;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  open,
  onOpenChange,
  user,
  nick,
  joinedAt,
  roles = [],
}) => {
  const [copied, setCopied] = React.useState(false);

  const displayName = nick || user.global_name || user.username;
  const initial = displayName.charAt(0).toUpperCase();

  const handleCopyId = () => {
    navigator.clipboard.writeText(user.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formattedDate = joinedAt
    ? new Date(joinedAt).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 animate-in fade-in-0" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] max-w-[90vw] bg-[#232428] text-[#dbdee1] rounded-2xl shadow-2xl overflow-hidden z-50 border border-[#2b2d31] outline-none">
          {/* Header Banner */}
          <div className="h-28 bg-gradient-to-r from-[#5865F2] to-[#4752c4] relative">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center text-white transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Profile Body */}
          <div className="px-6 pb-6 relative pt-0">
            {/* Avatar overlapping banner */}
            <div className="relative -mt-14 mb-3 inline-block">
              <div className="w-24 h-24 rounded-full bg-[#5865F2] border-[6px] border-[#232428] flex items-center justify-center text-3xl font-bold text-white shadow-lg overflow-hidden">
                {user.avatar ? (
                  <img src={user.avatar} alt={displayName} className="w-full h-full object-cover" />
                ) : (
                  initial
                )}
              </div>
            </div>

            {/* Names & User Card Box */}
            <div className="bg-[#111214] p-4 rounded-xl border border-[#2b2d31] space-y-4">
              <div>
                <h3 className="text-xl font-bold text-white leading-tight">{displayName}</h3>
                <div className="text-sm text-[#949ba4]">@{user.username}</div>
              </div>

              <div className="h-[1px] bg-[#2b2d31]" />

              {/* Roles */}
              {roles.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold text-[#949ba4] uppercase tracking-wider mb-2">
                    Cargos ({roles.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {roles.map((r) => {
                      const hex = r.color ? `#${r.color.toString(16).padStart(6, "0")}` : "#99aab5";
                      return (
                        <div
                          key={r.id}
                          className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#2b2d31] text-xs font-medium text-[#dbdee1]"
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hex }} />
                          <span>{r.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Joined Date */}
              {formattedDate && (
                <div>
                  <div className="text-[11px] font-bold text-[#949ba4] uppercase tracking-wider mb-1">
                    Membro Desde
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[#dbdee1]">
                    <Calendar className="w-3.5 h-3.5 text-[#949ba4]" />
                    <span>{formattedDate}</span>
                  </div>
                </div>
              )}

              {/* User ID copy */}
              <div className="pt-1 flex items-center justify-between text-xs text-[#949ba4]">
                <span>ID: {user.id}</span>
                <button
                  type="button"
                  onClick={handleCopyId}
                  className="flex items-center gap-1 text-[#5865F2] hover:underline font-medium cursor-pointer"
                >
                  {copied ? <Check className="w-3 h-3 text-[#23a55a]" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? "Copiado!" : "Copiar ID"}</span>
                </button>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
