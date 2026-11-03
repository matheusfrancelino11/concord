import React from "react";
import { useAuthStore } from "../../stores/authStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { useVoiceStore } from "../../stores/voiceStore";
import { UserStatus } from "../../types";
import { Mic, MicOff, Headphones, LogOut, Check } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

const STATUS_CONFIG: Record<
  UserStatus,
  { label: string; color: string; desc: string }
> = {
  online: { label: "Online", color: "bg-[#23a55a]", desc: "" },
  idle: { label: "Idle", color: "bg-[#f0b232]", desc: "" },
  dnd: { label: "Do Not Disturb", color: "bg-[#f23f43]", desc: "Will not receive desktop notifications" },
  invisible: { label: "Invisible", color: "bg-[#80848e]", desc: "Appear offline to others" },
  offline: { label: "Offline", color: "bg-[#80848e]", desc: "" },
};

export const UserFooter: React.FC = () => {
  const { user, logout } = useAuthStore();
  const { myStatus, updateMyStatus } = usePresenceStore();
  const { isMuted, isDeafened, toggleMute, toggleDeafen } = useVoiceStore();

  const getInitial = (name?: string): string => {
    return name ? name.charAt(0).toUpperCase() : "?";
  };

  const currentConfig = STATUS_CONFIG[myStatus] || STATUS_CONFIG.online;

  return (
    <footer aria-label="User status footer" className="h-[52px] min-h-[52px] bg-[#232428] px-2 flex items-center justify-between text-sm select-none">
      {/* Left: Avatar, Username & Status Dropdown */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <div className="flex items-center gap-2 p-1 -ml-1 rounded hover:bg-[#35373c]/50 transition cursor-pointer max-w-[130px] outline-none">
            <div className="relative w-8 h-8 rounded-full bg-[#5865F2] flex items-center justify-center text-white font-semibold text-xs shrink-0">
              {user?.avatar ? (
                <img src={user.avatar} alt={user.username} className="w-full h-full rounded-full object-cover" />
              ) : (
                getInitial(user?.global_name || user?.username)
              )}
              {/* Status badge */}
              <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 ${currentConfig.color} border-2 border-[#232428] rounded-full`} />
            </div>

            <div className="flex flex-col min-w-0">
              <span className="text-xs font-semibold text-[#f2f3f5] leading-tight truncate">
                {user?.global_name || user?.username || "Concord User"}
              </span>
              <span className="text-[11px] text-[#949ba4] leading-tight truncate capitalize">
                {currentConfig.label}
              </span>
            </div>
          </div>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="top"
            align="start"
            sideOffset={8}
            className="w-56 bg-[#111214] border border-[#2b2d31] p-1.5 rounded-md shadow-2xl text-xs font-medium z-50 text-[#dbdee1] animate-in fade-in-0 zoom-in-95"
          >
            <div className="px-2 py-1.5 font-bold text-[10px] text-[#949ba4] uppercase tracking-wider">
              Set Status
            </div>

            {(["online", "idle", "dnd", "invisible"] as UserStatus[]).map((statusKey) => {
              const cfg = STATUS_CONFIG[statusKey];
              const isSelected = myStatus === statusKey;
              return (
                <DropdownMenu.Item
                  key={statusKey}
                  onClick={() => updateMyStatus(statusKey)}
                  className="flex items-center justify-between px-2.5 py-2 rounded text-[#dbdee1] hover:bg-[#5865F2] hover:text-white cursor-pointer transition-colors outline-none"
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${cfg.color} shrink-0`} />
                    <div className="flex flex-col">
                      <span className="font-semibold text-xs">{cfg.label}</span>
                      {cfg.desc && (
                        <span className="text-[10px] text-[#949ba4] group-hover:text-white/80 leading-tight">
                          {cfg.desc}
                        </span>
                      )}
                    </div>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                </DropdownMenu.Item>
              );
            })}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* Right: Audio & Session Controls */}
      <div className="flex items-center text-[#b5bac1]">
        <button
          type="button"
          onClick={toggleMute}
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
          onClick={toggleDeafen}
          title={isDeafened ? "Undeafen" : "Deafen"}
          aria-label={isDeafened ? "Undeafen" : "Deafen"}
          className={`p-1.5 hover:bg-[#35373c] rounded transition cursor-pointer ${
            isDeafened ? "text-[#f23f43]" : "hover:text-white"
          }`}
        >
          {isDeafened ? <Headphones className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
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
