import React, { useState, useEffect, FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useGuildStore } from "../../stores/guildStore";
import { useAuthStore } from "../../stores/authStore";
import { X, Loader2 } from "lucide-react";

interface CreateServerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const CreateServerModal: React.FC<CreateServerModalProps> = ({ open, onOpenChange }) => {
  const { user } = useAuthStore();
  const { createGuild } = useGuildStore();

  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(user?.username ? `${user.username}'s server` : "My Server");
      setError(null);
    }
  }, [open, user]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 100) {
      setError("Server name must be between 2 and 100 characters.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await createGuild({ name: trimmed });
      onOpenChange(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create server.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 animate-in fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#313338] text-white rounded-lg shadow-2xl overflow-hidden z-50 border border-[#2b2d31] animate-in fade-in-0 zoom-in-95">
          <div className="pt-6 px-6 text-center relative">
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close dialog"
                className="absolute top-4 right-4 text-[#949ba4] hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>

            <Dialog.Title className="text-2xl font-bold text-[#f2f3f5]">
              Customize your server
            </Dialog.Title>
            <Dialog.Description className="text-sm text-[#949ba4] mt-2">
              Give your new server a personality with a name. You can always change it later.
            </Dialog.Description>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="px-6 pt-6 space-y-4">
              {error && (
                <div className="bg-[#f23f43]/15 border border-[#f23f43]/50 rounded p-2.5 text-[#fa777a] text-xs">
                  {error}
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-[#b5bac1] uppercase tracking-wider mb-2 block">
                  Server Name <span className="text-[#f23f43]">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (error) setError(null);
                  }}
                  className="w-full bg-[#1e1f22] border border-[#1e1f22] focus:border-[#5865F2] focus:outline-none rounded-[3px] px-3 py-2 text-sm text-[#f2f3f5] transition-colors"
                  placeholder="e.g. Lounge"
                />
                <p className="text-[11px] text-[#949ba4] mt-2">
                  Creating a server automatically creates the @everyone role and #geral channel.
                </p>
              </div>
            </div>

            <div className="bg-[#2b2d31] px-6 py-4 flex justify-between items-center mt-6">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="text-sm text-white hover:underline cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-[#5865F2] hover:bg-[#4752c4] active:bg-[#3c45a5] text-white font-medium px-6 py-2 rounded-[3px] text-sm transition disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Create</span>
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
