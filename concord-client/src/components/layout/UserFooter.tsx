import React, { useState } from "react";
import { useAuthStore } from "../../stores/authStore";
import { Mic, MicOff, Headphones, LogOut } from "lucide-react";

export const UserFooter: React.FC = () => {
  const { user, logout } = useAuthStore();
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);

  const getInitial = (name?: string): string => {
    return name ? name.charAt(0).toUpperCase() : "?";
  };

  return (
    <footer aria-label="User status footer" className="h-[52px] min-h-[52px] bg-[#232428] px-2 flex items-center justify-between text-sm select-none">
      {/* Left: Avatar & Username */}
      <div className="flex items-center gap-2 p-1 -ml-1 rounded hover:bg-[#35373c]/50 transition cursor-pointer max-w-[130px]">
        <div className="relative w-8 h-8 rounded-full bg-[#5865F2] flex items-center justify-center text-white font-semibold text-xs shrink-0">
          {user?.avatar ? (
            <img src={user.avatar} alt={user.username} className="w-full h-full rounded-full object-cover" />
          ) : (
            getInitial(user?.global_name || user?.username)
          )}
          {/* Online badge */}
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-[#23a55a] border-2 border-[#232428] rounded-full" />
        </div>

        <div className="flex flex-col min-w-0">
          <span className="text-xs font-semibold text-[#f2f3f5] leading-tight truncate">
            {user?.global_name || user?.username || "Concord User"}
          </span>
          <span className="text-[11px] text-[#949ba4] leading-tight truncate">
            Online
          </span>
        </div>
      </div>

      {/* Right: Audio & Session Controls */}
      <div className="flex items-center text-[#b5bac1]">
        <button
          type="button"
          onClick={() => setIsMuted(!isMuted)}
          title={isMuted ? "Unmute" : "Mute"}
          aria-label={isMuted ? "Unmute" : "Mute"}
          className={`p-1.5 hover:bg-[#35373c] rounded transition cursor-pointer ${
            isMuted ? "text-[#f23f43]" : "hover:text-white"
          }`}
        >
          {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>

        <button
          type="button"
          onClick={() => setIsDeafened(!isDeafened)}
          title={isDeafened ? "Undeafen" : "Deafen"}
          aria-label={isDeafened ? "Undeafen" : "Deafen"}
          className={`p-1.5 hover:bg-[#35373c] rounded transition cursor-pointer ${
            isDeafened ? "text-[#f23f43]" : "hover:text-white"
          }`}
        >
          <Headphones className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={logout}
          title="Log Out"
          aria-label="Log Out"
          className="p-1.5 hover:bg-[#35373c] hover:text-[#f23f43] rounded transition cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </footer>
  );
};
