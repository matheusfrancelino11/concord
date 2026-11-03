import React, { useState, useEffect } from "react";
import { ConcordLogo } from "./ConcordLogo";

interface ConcordLoadingScreenProps {
  message?: string;
  subMessage?: string;
  fullscreen?: boolean;
}

const CONCORD_TIPS = [
  "Reunindo os amigos no servidor...",
  "Ajustando a sensibilidade do microfone...",
  "Carregando emojis e figurinhas marotas...",
  "Aquecendo a transmissão de tela em 60 FPS...",
  "Tramando a próxima vitória...",
  "Sintonizando os canais de voz...",
  "Dica: Pressione Ctrl+Shift+M para mutar o microfone rapidamente.",
  "Dica: Você pode ajustar o volume individual de cada amigo pelo botão direito.",
  "Quase lá, preparando a melhor experiência...",
];

export const ConcordLoadingScreen: React.FC<ConcordLoadingScreenProps> = ({
  message,
  subMessage,
  fullscreen = true,
}) => {
  const [tipIndex, setTipIndex] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setTipIndex((prev) => (prev + 1) % CONCORD_TIPS.length);
        setFade(true);
      }, 300);
    }, 3200);

    return () => clearInterval(interval);
  }, []);

  const containerClasses = fullscreen
    ? "fixed inset-0 z-50 bg-[#1e1f22] flex flex-col items-center justify-center select-none overflow-hidden"
    : "w-full h-full min-h-[300px] bg-[#1e1f22] flex flex-col items-center justify-center select-none";

  return (
    <div className={containerClasses}>
      {/* Ambient background glow */}
      <div className="absolute w-[450px] h-[450px] bg-[#1FCE66]/10 rounded-full blur-[100px] pointer-events-none" />

      {/* Mascot Card / Icon */}
      <div className="relative flex flex-col items-center">
        <div className="relative mb-6 animate-concord-bounce">
          {/* Subtle outer glow halo */}
          <div className="absolute inset-0 rounded-[28px] animate-concord-glow pointer-events-none" />
          
          <div className="relative rounded-[28px] overflow-hidden p-1 bg-gradient-to-br from-[#24D366] to-[#1DB954] shadow-2xl">
            <ConcordLogo
              size={88}
              variant="full"
              animated={true}
              className="drop-shadow-lg"
            />
          </div>

          {/* Cheeky badge */}
          <div className="absolute -bottom-2 -right-2 bg-[#2b2d31] border border-[#1FCE66]/40 rounded-full px-2 py-0.5 text-[10px] font-bold text-[#1FCE66] shadow">
            ON
          </div>
        </div>

        {/* Brand Title */}
        <h2 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <span>Concord</span>
          <span className="w-2 h-2 rounded-full bg-[#1FCE66] animate-ping" />
        </h2>

        {/* Primary Message */}
        <p className="text-sm font-medium text-[#dbdee1] mt-2 mb-1">
          {message || "Carregando o Concord..."}
        </p>

        {/* Rotating Tips / Fun Loading Quotes */}
        <p
          className={`text-xs text-[#949ba4] max-w-xs text-center min-h-[36px] transition-opacity duration-300 ${
            fade ? "opacity-100" : "opacity-0"
          }`}
        >
          {subMessage || CONCORD_TIPS[tipIndex]}
        </p>

        {/* Subtle bouncing dots */}
        <div className="flex items-center gap-1.5 mt-3">
          <span className="w-1.5 h-1.5 rounded-full bg-[#1FCE66] animate-bounce [animation-delay:-0.3s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-[#1FCE66] animate-bounce [animation-delay:-0.15s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-[#1FCE66] animate-bounce" />
        </div>
      </div>
    </div>
  );
};
