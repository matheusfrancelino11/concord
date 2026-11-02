import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, LogIn, Loader2 } from "lucide-react";
import { useGuildStore } from "../../stores/guildStore";

interface JoinServerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const JoinServerModal: React.FC<JoinServerModalProps> = ({
  open,
  onOpenChange,
}) => {
  const { joinGuildWithInvite } = useGuildStore();
  const [inputVal, setInputVal] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = inputVal.trim();
    if (!raw) return;

    // Extract code if user pasted a full URL (e.g. http://localhost:1420/invite/x5RdfgbP)
    let code = raw;
    if (raw.includes("/")) {
      const parts = raw.split("/");
      code = parts[parts.length - 1] || raw;
    }

    setIsLoading(true);
    setError(null);

    try {
      await joinGuildWithInvite(code);
      setInputVal("");
      onOpenChange(false);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to join server. Check the code.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 animate-in fade-in-0 duration-150" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#313338] text-white rounded-lg shadow-2xl p-6 z-50 border border-[#232428] animate-in fade-in-0 zoom-in-95 duration-150 outline-none">
          <div className="flex items-center justify-between pb-3">
            <Dialog.Title className="text-lg font-bold text-[#f2f3f5] flex items-center gap-2">
              <LogIn className="w-5 h-5 text-[#23a55a]" />
              Join a Server
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

          <Dialog.Description className="text-xs text-[#949ba4] mb-4">
            Enter an invite code below to join an existing server with your friends.
          </Dialog.Description>

          {error && (
            <div className="mb-4 p-2.5 bg-[#f23f43]/10 border border-[#f23f43]/30 rounded text-[#f23f43] text-xs">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-bold text-[#b5bac1] uppercase tracking-wider mb-2">
                Invite Code or Link <span className="text-[#f23f43]">*</span>
              </label>
              <input
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                placeholder="e.g. c7k9Xm2q or http://.../c7k9Xm2q"
                required
                disabled={isLoading}
                className="w-full bg-[#1e1f22] text-[#f2f3f5] px-3 py-2.5 rounded border border-[#1e1f22] focus:border-[#5865F2] outline-none text-sm transition placeholder-[#80848e]"
              />
              <span className="text-[11px] text-[#949ba4] mt-1 block">
                Invites look like <span className="font-mono text-[#dbdee1]">x5RdfgbP</span>
              </span>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="text-xs text-[#949ba4] hover:text-white hover:underline transition cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={isLoading || !inputVal.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#23a55a] hover:bg-[#1f934f] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded transition cursor-pointer"
              >
                {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Join Server
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
