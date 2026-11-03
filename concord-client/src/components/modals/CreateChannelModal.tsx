import React, { useState, useEffect, FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useChannelStore } from "../../stores/channelStore";
import { useGuildStore } from "../../stores/guildStore";
import { X, Hash, Volume2, Loader2 } from "lucide-react";

interface CreateChannelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType?: 0 | 2;
}

export const CreateChannelModal: React.FC<CreateChannelModalProps> = ({
  open,
  onOpenChange,
  initialType = 0,
}) => {
  const { selectedGuildId, activeGuildId } = useGuildStore();
  const { createChannel } = useChannelStore();

  const currentGuildId = selectedGuildId || activeGuildId;

  const [type, setType] = useState<0 | 2>(initialType);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setType(initialType);
      setName("");
      setTopic("");
      setError(null);
    }
  }, [open, initialType]);

  const handleNameChange = (val: string) => {
    if (type === 0) {
      // Auto-sanitize text channel name: lowercase, spaces to hyphens, alphanumeric + hyphen
      const sanitized = val.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "");
      setName(sanitized);
    } else {
      setName(val);
    }
    if (error) setError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentGuildId) {
      setError("Nenhum servidor selecionado.");
      return;
    }

    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 100) {
      setError("O nome do canal deve ter entre 1 e 100 caracteres.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await createChannel(currentGuildId, {
        name: trimmed,
        type,
        topic: topic.trim() || undefined,
      });
      onOpenChange(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Falha ao criar canal.";
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
          <div className="p-6 pb-2 relative">
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Fechar"
                className="absolute top-4 right-4 text-[#949ba4] hover:text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>

            <Dialog.Title className="text-xl font-bold text-[#f2f3f5]">
              Criar Canal
            </Dialog.Title>
            <Dialog.Description className="text-xs text-[#949ba4] mt-1">
              em {type === 0 ? "Canais de Texto" : "Canais de Voz"}
            </Dialog.Description>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="px-6 space-y-4 pt-2">
              {error && (
                <div className="bg-[#f23f43]/15 border border-[#f23f43]/50 rounded p-2.5 text-[#fa777a] text-xs">
                  {error}
                </div>
              )}

              {/* Channel Type Selector */}
              <div>
                <label className="text-xs font-bold text-[#b5bac1] uppercase tracking-wider mb-2 block">
                  Tipo de Canal
                </label>
                <div className="space-y-2">
                  <div
                    onClick={() => {
                      setType(0);
                      setName((prev) => prev.toLowerCase().replace(/\s+/g, "-"));
                    }}
                    className={`flex items-center gap-3 p-3 rounded-md cursor-pointer border transition-colors ${
                      type === 0
                        ? "bg-[#2b2d31] border-[#5865F2]"
                        : "bg-[#2b2d31]/50 border-transparent hover:bg-[#35373c]"
                    }`}
                  >
                    <Hash className="w-6 h-6 text-[#949ba4] shrink-0" />
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-white">Texto</div>
                      <div className="text-xs text-[#949ba4]">Poste mensagens, imagens e conversas</div>
                    </div>
                    <div
                      className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                        type === 0 ? "border-[#5865F2]" : "border-[#949ba4]"
                      }`}
                    >
                      {type === 0 && <div className="w-2 h-2 rounded-full bg-[#5865F2]" />}
                    </div>
                  </div>

                  <div
                    onClick={() => setType(2)}
                    className={`flex items-center gap-3 p-3 rounded-md cursor-pointer border transition-colors ${
                      type === 2
                        ? "bg-[#2b2d31] border-[#5865F2]"
                        : "bg-[#2b2d31]/50 border-transparent hover:bg-[#35373c]"
                    }`}
                  >
                    <Volume2 className="w-6 h-6 text-[#949ba4] shrink-0" />
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-white">Voz</div>
                      <div className="text-xs text-[#949ba4]">Converse por voz, vídeo e compartilhamento de tela</div>
                    </div>
                    <div
                      className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                        type === 2 ? "border-[#5865F2]" : "border-[#949ba4]"
                      }`}
                    >
                      {type === 2 && <div className="w-2 h-2 rounded-full bg-[#5865F2]" />}
                    </div>
                  </div>
                </div>
              </div>

              {/* Channel Name */}
              <div>
                <label className="text-xs font-bold text-[#b5bac1] uppercase tracking-wider mb-2 block">
                  Nome do Canal <span className="text-[#f23f43]">*</span>
                </label>
                <div className="relative flex items-center">
                  <div className="absolute left-3 text-[#949ba4]">
                    {type === 0 ? <Hash className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </div>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    className="w-full bg-[#1e1f22] border border-[#1e1f22] focus:border-[#5865F2] focus:outline-none rounded-[3px] pl-9 pr-3 py-2 text-sm text-[#f2f3f5] placeholder-zinc-500 transition-colors"
                    placeholder={type === 0 ? "novo-canal" : "Voz Geral"}
                  />
                </div>
              </div>

              {/* Channel Topic */}
              <div>
                <label className="text-xs font-bold text-[#b5bac1] uppercase tracking-wider mb-2 block">
                  Tópico do Canal <span className="text-[#949ba4] font-normal normal-case">(Opcional)</span>
                </label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="w-full bg-[#1e1f22] border border-[#1e1f22] focus:border-[#5865F2] focus:outline-none rounded-[3px] px-3 py-2 text-sm text-[#f2f3f5] placeholder-zinc-500 transition-colors"
                  placeholder="Conte a todos sobre o que é este canal"
                />
              </div>
            </div>

            <div className="bg-[#2b2d31] px-6 py-4 flex justify-end gap-3 items-center mt-6">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="text-sm text-white hover:underline cursor-pointer px-3 py-2"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-[#5865F2] hover:bg-[#4752c4] active:bg-[#3c45a5] text-white font-medium px-5 py-2 rounded-[3px] text-sm transition disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Criar Canal</span>
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
