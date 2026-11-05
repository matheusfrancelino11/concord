import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LogOut, X } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { useVoiceStore } from "../../stores/voiceStore";

interface LogoutConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmed?: () => void;
}

export const LogoutConfirmModal: React.FC<LogoutConfirmModalProps> = ({
  open,
  onOpenChange,
  onConfirmed,
}) => {
  const logout = useAuthStore((s) => s.logout);
  const leaveVoiceChannel = useVoiceStore((s) => s.leaveVoiceChannel);

  const handleConfirmLogout = () => {
    // 1. Leave any active voice channels & teardown WebRTC tracks
    try {
      leaveVoiceChannel();
    } catch (err) {
      console.warn("[LogoutConfirmModal] Error leaving voice channel on logout:", err);
    }

    // 2. Clear credentials and session state
    logout();

    // 3. Close parent modals/dialogs
    if (onConfirmed) {
      onConfirmed();
    }
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] animate-in fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#313338] text-white rounded-lg shadow-2xl overflow-hidden z-[60] border border-[#2b2d31] animate-in fade-in-0 zoom-in-95 outline-none">
          <div className="pt-6 px-6 relative">
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Fechar"
                className="absolute top-4 right-4 text-[#949ba4] hover:text-white transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>

            <Dialog.Title className="text-xl font-bold text-[#f2f3f5] flex items-center gap-2">
              <LogOut className="w-5 h-5 text-[#f23f43]" />
              <span>Sair da Conta</span>
            </Dialog.Title>

            <Dialog.Description className="text-sm text-[#949ba4] mt-3 leading-relaxed">
              Deseja realmente sair da sua conta Concord? Será necessário inserir suas credenciais novamente para entrar.
            </Dialog.Description>
          </div>

          <div className="bg-[#2b2d31] px-6 py-4 flex justify-end items-center gap-3 mt-6">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 text-sm font-medium text-white bg-[#4e5058] hover:bg-[#5c5e66] rounded transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirmLogout}
              className="px-4 py-2 text-sm font-semibold text-white bg-[#f23f43] hover:bg-[#da373b] rounded transition cursor-pointer shadow-md flex items-center gap-1.5"
            >
              <LogOut className="w-4 h-4" />
              <span>Sair</span>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
