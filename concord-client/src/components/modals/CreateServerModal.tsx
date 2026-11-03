import React, { useState, useEffect, FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useGuildStore } from "../../stores/guildStore";
import { useAuthStore } from "../../stores/authStore";
import { X, Loader2 } from "lucide-react";

interface CreateServerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenJoinServer?: () => void;
}

export const CreateServerModal: React.FC<CreateServerModalProps> = ({
  open,
  onOpenChange,
  onOpenJoinServer,
}) => {
  const { user } = useAuthStore();
  const { createGuild } = useGuildStore();

  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(user?.username ? `Servidor de ${user.username}` : "Meu Servidor");
      setError(null);
    }
  }, [open, user]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 100) {
      setError("O nome do servidor deve ter entre 2 e 100 caracteres.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await createGuild({ name: trimmed });
      onOpenChange(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Falha ao criar servidor.";
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
                aria-label="Fechar"
                className="absolute top-4 right-4 text-[#949ba4] hover:text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>

            <Dialog.Title className="text-2xl font-bold text-[#f2f3f5]">
              Personalize seu servidor
            </Dialog.Title>
            <Dialog.Description className="text-sm text-[#949ba4] mt-2">
              Dê personalidade ao seu novo servidor escolhendo um nome. Você sempre pode alterá-lo mais tarde.
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
                  Nome do Servidor <span className="text-[#f23f43]">*</span>
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
                  placeholder="ex: Cantinho dos Amigos"
                />
                <p className="text-[11px] text-[#949ba4] mt-2">
                  Ao criar um servidor, o cargo @everyone e o canal #geral são gerados automaticamente.
                </p>
              </div>
            </div>

            <div className="bg-[#2b2d31] px-6 py-4 flex justify-between items-center mt-6">
              {onOpenJoinServer ? (
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    onOpenJoinServer();
                  }}
                  className="text-xs text-[#23a55a] hover:underline font-semibold cursor-pointer"
                >
                  Já tem um convite? Entrar em um servidor
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="text-sm text-white hover:underline cursor-pointer"
                >
                  Voltar
                </button>
              )}
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-[#5865F2] hover:bg-[#4752c4] active:bg-[#3c45a5] text-white font-medium px-6 py-2 rounded-[3px] text-sm transition disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Criar</span>
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
