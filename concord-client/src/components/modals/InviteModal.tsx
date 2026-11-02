import React, { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Copy, Check, Link, Loader2 } from "lucide-react";
import { api } from "../../api/client";
import { useGuildStore } from "../../stores/guildStore";

interface InviteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guildId: string;
}

export const InviteModal: React.FC<InviteModalProps> = ({
  open,
  onOpenChange,
  guildId,
}) => {
  const { guilds } = useGuildStore();
  const currentGuild = guilds.find((g) => g.id === guildId);

  const [inviteCode, setInviteCode] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && guildId) {
      setIsLoading(true);
      setError(null);
      setCopied(false);

      api.invites
        .create(guildId, { max_uses: 0, max_age: 86400 })
        .then((inv) => {
          setInviteCode(inv.code);
        })
        .catch((err) => {
          console.error("Failed to generate invite:", err);
          setError("Failed to create invite code.");
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [open, guildId]);

  const inviteLink = inviteCode
    ? `${window.location.origin}/invite/${inviteCode}`
    : "";

  const handleCopy = () => {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyLink = () => {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 animate-in fade-in-0 duration-150" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#313338] text-white rounded-lg shadow-2xl p-6 z-50 border border-[#232428] animate-in fade-in-0 zoom-in-95 duration-150 outline-none">
          <div className="flex items-center justify-between pb-3">
            <Dialog.Title className="text-lg font-bold text-[#f2f3f5] flex items-center gap-2">
              <Link className="w-5 h-5 text-[#5865F2]" />
              Invite Friends to {currentGuild?.name || "Server"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="text-[#949ba4] hover:text-white transition p-1 cursor-pointer rounded"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>

          <p className="text-xs text-[#949ba4] mb-4">
            Share this invite code or link with your friends to let them join this server immediately.
          </p>

          {isLoading ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2 text-[#949ba4]">
              <Loader2 className="w-6 h-6 animate-spin text-[#5865F2]" />
              <span className="text-xs">Generating invite code...</span>
            </div>
          ) : error ? (
            <div className="p-3 bg-[#f23f43]/10 border border-[#f23f43]/30 rounded text-[#f23f43] text-xs">
              {error}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Invite Code Section */}
              <div>
                <label className="block text-[11px] font-bold text-[#b5bac1] uppercase tracking-wider mb-1.5">
                  Invite Code
                </label>
                <div className="flex items-center gap-2 bg-[#1e1f22] p-2 rounded border border-[#2b2d31]">
                  <span className="font-mono text-sm text-[#f2f3f5] tracking-widest font-bold px-2 select-all flex-1">
                    {inviteCode}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#5865F2] hover:bg-[#4752c4] text-white text-xs font-semibold rounded transition cursor-pointer"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Code</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Shareable Link preview */}
              <div>
                <label className="block text-[11px] font-bold text-[#b5bac1] uppercase tracking-wider mb-1.5">
                  Shareable Link
                </label>
                <div className="flex items-center justify-between text-xs text-[#949ba4] bg-[#1e1f22] p-2 rounded border border-[#2b2d31]">
                  <span className="truncate pr-2 font-mono">{inviteLink}</span>
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="text-[#5865F2] hover:underline shrink-0 text-xs font-medium cursor-pointer"
                  >
                    Copy Link
                  </button>
                </div>
              </div>

              <div className="text-[11px] text-[#949ba4] pt-1">
                Your invite code will expire in 24 hours with unlimited uses.
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 bg-[#35373c] hover:bg-[#404249] text-white text-sm font-medium rounded transition cursor-pointer"
            >
              Done
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
