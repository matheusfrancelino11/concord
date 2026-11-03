import React, { useState, FormEvent } from "react";
import { useAuthStore } from "../../stores/authStore";
import { AlertCircle, Loader2 } from "lucide-react";
import { ConcordLogo } from "../common/ConcordLogo";

interface RegisterViewProps {
  onNavigateToLogin: () => void;
}

export const RegisterView: React.FC<RegisterViewProps> = ({ onNavigateToLogin }) => {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [globalName, setGlobalName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const { register, isLoading, error: apiError, clearError } = useAuthStore();

  const validate = (): boolean => {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedUsername = username.trim();

    if (!trimmedEmail) {
      setValidationError("Email is required.");
      return false;
    }
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(trimmedEmail)) {
      setValidationError("Please enter a valid email address.");
      return false;
    }

    if (!trimmedUsername) {
      setValidationError("Username is required.");
      return false;
    }
    const usernameRegex = /^[a-zA-Z0-9_.-]{2,32}$/;
    if (!usernameRegex.test(trimmedUsername)) {
      setValidationError("Username must be 2-32 characters (letters, numbers, underscores, dots, hyphens).");
      return false;
    }

    if (!password) {
      setValidationError("Password is required.");
      return false;
    }
    if (password.length < 8) {
      setValidationError("Password must be at least 8 characters long.");
      return false;
    }
    if (password.length > 72) {
      setValidationError("Password must not exceed 72 characters.");
      return false;
    }

    if (password !== confirmPassword) {
      setValidationError("Passwords do not match.");
      return false;
    }

    setValidationError(null);
    return true;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    clearError();
    try {
      await register({
        email: email.trim().toLowerCase(),
        username: username.trim(),
        password,
        global_name: globalName.trim() || undefined,
      });
    } catch {
      // Handled in authStore error state
    }
  };

  const activeError = validationError || apiError;

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#1e1f22] p-4 select-none">
      <div className="w-full max-w-[480px] bg-[#313338] text-white p-8 rounded-lg shadow-2xl border border-[#2b2d31]/60">
        <div className="flex flex-col items-center mb-4">
          <ConcordLogo size={64} variant="full" animated={true} />
        </div>
        <h1 className="text-2xl font-bold text-center text-[#f2f3f5]">Criar uma conta</h1>
        <p className="text-[#949ba4] text-center text-sm mt-1 mb-6">
          Faça parte do Concord com seus amigos
        </p>

        {activeError && (
          <div className="bg-[#f23f43]/15 border border-[#f23f43]/50 rounded-md p-3 mb-5 text-[#fa777a] text-xs flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{activeError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-[#b5bac1] uppercase tracking-wider mb-2 block">
              E-mail <span className="text-[#f23f43]">*</span>
            </label>
            <input
              type="email"
              autoFocus
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (validationError) setValidationError(null);
              }}
              className="w-full bg-[#1e1f22] border border-[#1e1f22] focus:border-[#5865F2] focus:outline-none rounded-[3px] px-3 py-2 text-sm text-[#f2f3f5] placeholder-zinc-500 transition-colors"
              placeholder="nome@exemplo.com"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-[#b5bac1] uppercase tracking-wider mb-2 block">
              Nome de Exibição <span className="text-[#949ba4] font-normal normal-case">(Opcional)</span>
            </label>
            <input
              type="text"
              value={globalName}
              onChange={(e) => setGlobalName(e.target.value)}
              className="w-full bg-[#1e1f22] border border-[#1e1f22] focus:border-[#5865F2] focus:outline-none rounded-[3px] px-3 py-2 text-sm text-[#f2f3f5] placeholder-zinc-500 transition-colors"
              placeholder="Como seus amigos verão você"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-[#b5bac1] uppercase tracking-wider mb-2 block">
              Nome de Usuário <span className="text-[#f23f43]">*</span>
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (validationError) setValidationError(null);
              }}
              className="w-full bg-[#1e1f22] border border-[#1e1f22] focus:border-[#5865F2] focus:outline-none rounded-[3px] px-3 py-2 text-sm text-[#f2f3f5] placeholder-zinc-500 transition-colors"
              placeholder="ex: alice"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-[#b5bac1] uppercase tracking-wider mb-2 block">
              Senha <span className="text-[#f23f43]">*</span>
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (validationError) setValidationError(null);
              }}
              className="w-full bg-[#1e1f22] border border-[#1e1f22] focus:border-[#5865F2] focus:outline-none rounded-[3px] px-3 py-2 text-sm text-[#f2f3f5] placeholder-zinc-500 transition-colors"
              placeholder="Pelo menos 8 caracteres"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-[#b5bac1] uppercase tracking-wider mb-2 block">
              Confirmar Senha <span className="text-[#f23f43]">*</span>
            </label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (validationError) setValidationError(null);
              }}
              className="w-full bg-[#1e1f22] border border-[#1e1f22] focus:border-[#5865F2] focus:outline-none rounded-[3px] px-3 py-2 text-sm text-[#f2f3f5] placeholder-zinc-500 transition-colors"
              placeholder="Repita sua senha"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-[#5865F2] hover:bg-[#4752c4] active:bg-[#3c45a5] text-white font-medium py-2.5 rounded-[3px] text-sm transition-colors mt-6 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Criando conta...</span>
              </>
            ) : (
              "Continuar"
            )}
          </button>
        </form>

        <div className="text-xs text-[#949ba4] mt-4">
          Já tem uma conta?{" "}
          <button
            type="button"
            onClick={() => {
              clearError();
              onNavigateToLogin();
            }}
            className="text-[#00a8fc] hover:underline font-normal cursor-pointer"
          >
            Entrar
          </button>
        </div>
      </div>
    </div>
  );
};
