import React from "react";
import { useGuildStore } from "../../stores/guildStore";
import { Plus } from "lucide-react";
import { ConcordLogo } from "../common/ConcordLogo";
import * as Tooltip from "@radix-ui/react-tooltip";

interface SidebarProps {
  onOpenCreateServer: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onOpenCreateServer }) => {
  const { guilds, selectedGuildId, activeGuildId, selectGuild } = useGuildStore();
  const currentGuildId = selectedGuildId || activeGuildId;

  const getInitials = (name: string): string => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <Tooltip.Provider delayDuration={100}>
      <nav aria-label="Servers sidebar" className="w-[72px] min-w-[72px] max-w-[72px] h-full bg-[#1e1f22] flex flex-col items-center py-3 select-none z-20">
        {/* Direct Messages / Home button */}
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <div className="relative group flex items-center justify-center w-full mb-1">
              <div
                className={`absolute left-0 w-1 bg-white rounded-r transition-all duration-200 ${
                  currentGuildId === null ? "h-10" : "h-0 group-hover:h-5"
                }`}
              />
              <button
                type="button"
                onClick={() => selectGuild("")}
                aria-label="Direct Messages"
                className={`w-12 h-12 flex items-center justify-center transition-all duration-200 cursor-pointer overflow-hidden ${
                  currentGuildId === null
                    ? "rounded-[16px] bg-[#1FCE66] text-white shadow-lg shadow-[#1FCE66]/20"
                    : "rounded-[24px] bg-[#313338] text-[#dbdee1] hover:rounded-[16px] hover:bg-[#1FCE66] hover:text-white"
                }`}
              >
                <ConcordLogo
                  size={28}
                  variant="mascot"
                  animated={false}
                  eyeColor={currentGuildId === null ? "#1FCE66" : "#2b2d31"}
                  bodyColor="#FFFFFF"
                />
              </button>
            </div>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="right"
              sideOffset={12}
              className="bg-[#111214] text-white text-xs font-semibold px-3 py-1.5 rounded-md shadow-lg z-50 animate-in fade-in-0 zoom-in-95"
            >
              Direct Messages
              <Tooltip.Arrow className="fill-[#111214]" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>

        {/* Divider */}
        <div className="w-8 h-[2px] bg-[#35363c] rounded-[1px] my-1" />

        {/* Guilds List */}
        <div className="flex-1 w-full overflow-y-auto no-scrollbar flex flex-col items-center gap-2 pt-1">
          {guilds.map((guild) => {
            const isActive = guild.id === currentGuildId;
            return (
              <Tooltip.Root key={guild.id}>
                <Tooltip.Trigger asChild>
                  <div className="relative group flex items-center justify-center w-full">
                    {/* Active pill indicator */}
                    <div
                      className={`absolute left-0 w-1 bg-white rounded-r transition-all duration-200 ${
                        isActive ? "h-10" : "h-0 group-hover:h-5"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => selectGuild(guild.id)}
                      aria-label={`Server: ${guild.name}`}
                      className={`w-12 h-12 flex items-center justify-center text-sm font-semibold transition-all duration-200 cursor-pointer overflow-hidden ${
                        isActive
                          ? "rounded-[16px] bg-[#5865F2] text-white"
                          : "rounded-[24px] bg-[#313338] text-[#dbdee1] group-hover:rounded-[16px] group-hover:bg-[#5865F2] group-hover:text-white"
                      }`}
                    >
                      {guild.icon ? (
                        <img
                          src={guild.icon}
                          alt={guild.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        getInitials(guild.name)
                      )}
                    </button>
                  </div>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    side="right"
                    sideOffset={12}
                    className="bg-[#111214] text-white text-xs font-semibold px-3 py-1.5 rounded-md shadow-lg z-50 animate-in fade-in-0 zoom-in-95"
                  >
                    {guild.name}
                    <Tooltip.Arrow className="fill-[#111214]" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            );
          })}

          {/* Add a Server Button */}
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <div className="relative group flex items-center justify-center w-full mt-1">
                <button
                  type="button"
                  onClick={onOpenCreateServer}
                  aria-label="Add a Server"
                  className="w-12 h-12 rounded-[24px] bg-[#313338] text-[#23a55a] group-hover:rounded-[16px] group-hover:bg-[#23a55a] group-hover:text-white flex items-center justify-center transition-all duration-200 cursor-pointer"
                >
                  <Plus className="w-6 h-6" />
                </button>
              </div>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="right"
                sideOffset={12}
                className="bg-[#111214] text-white text-xs font-semibold px-3 py-1.5 rounded-md shadow-lg z-50 animate-in fade-in-0 zoom-in-95"
              >
                Add a Server
                <Tooltip.Arrow className="fill-[#111214]" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>
      </nav>
    </Tooltip.Provider>
  );
};
