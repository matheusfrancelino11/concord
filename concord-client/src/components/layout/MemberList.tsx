import React, { useMemo } from "react";
import { useGuildStore, EMPTY_MEMBERS } from "../../stores/guildStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { useVoiceStore } from "../../stores/voiceStore";
import { Member, UserStatus } from "../../types";
import { Crown, Tv } from "lucide-react";

interface MemberListProps {
  guildId: string;
}

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

const getStatusColor = (status: UserStatus): string => {
  switch (status) {
    case "online":
      return "bg-[#23a55a]";
    case "idle":
      return "bg-[#f0b232]";
    case "dnd":
      return "bg-[#f23f43]";
    case "offline":
    default:
      return "bg-[#80848e]";
  }
};

const getStatusTitle = (status: UserStatus): string => {
  switch (status) {
    case "online":
      return "Online";
    case "idle":
      return "Idle";
    case "dnd":
      return "Do Not Disturb";
    case "offline":
    default:
      return "Offline";
  }
};

export const MemberList: React.FC<MemberListProps> = ({ guildId }) => {
  const { guilds, membersByGuild } = useGuildStore();
  const presences = usePresenceStore((s) => s.presences);
  const voiceStates = useVoiceStore((s) => s.voiceStatesByGuild[guildId] || []);

  const currentGuild = guilds.find((g) => g.id === guildId);
  const members = membersByGuild[guildId] || EMPTY_MEMBERS;

  const streamingUserIds = useMemo(() => {
    return new Set(voiceStates.filter((vs) => vs.self_stream).map((vs) => vs.user_id));
  }, [voiceStates]);

  // Separate members into Online and Offline
  const { onlineMembers, offlineMembers } = useMemo(() => {
    const online: Array<{ member: Member; status: UserStatus }> = [];
    const offline: Array<{ member: Member; status: UserStatus }> = [];

    for (const m of members) {
      const status: UserStatus = presences[m.user_id] || "offline";
      if (status === "offline") {
        offline.push({ member: m, status });
      } else {
        online.push({ member: m, status });
      }
    }

    // Sort alphabetically by displayName
    const sortFn = (a: { member: Member }, b: { member: Member }) => {
      const nameA = a.member.nick || a.member.user?.global_name || a.member.user?.username || "";
      const nameB = b.member.nick || b.member.user?.global_name || b.member.user?.username || "";
      return nameA.localeCompare(nameB);
    };

    online.sort(sortFn);
    offline.sort(sortFn);

    return { onlineMembers: online, offlineMembers: offline };
  }, [members, presences]);

  const isOwner = (userId: string) => currentGuild?.owner_id === userId;

  const renderMemberItem = (item: { member: Member; status: UserStatus }) => {
    const { member, status } = item;
    const user = member.user;
    const displayName = member.nick || user?.global_name || user?.username || "Unknown";
    const username = user?.username || "";
    const isGuildOwner = isOwner(member.user_id);

    return (
      <div
        key={member.user_id}
        className="group flex items-center gap-3 px-2 py-1.5 rounded-[4px] hover:bg-[#35373c]/60 cursor-pointer transition-colors"
      >
        {/* Avatar with status indicator */}
        <div className="relative shrink-0">
          <div className="w-8 h-8 rounded-full bg-[#5865F2] flex items-center justify-center text-xs font-semibold text-white overflow-hidden">
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt={displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              getInitials(displayName)
            )}
          </div>
          {/* Status Badge */}
          <span
            title={getStatusTitle(status)}
            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#2b2d31] ${getStatusColor(
              status
            )}`}
          />
        </div>

        {/* Name and Crown */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`text-sm font-medium truncate ${
                status === "offline"
                  ? "text-[#949ba4] group-hover:text-[#dbdee1]"
                  : "text-[#dbdee1] group-hover:text-white"
              }`}
            >
              {displayName}
            </span>
            {streamingUserIds.has(member.user_id) && (
              <span className="flex items-center gap-0.5 px-1 py-0.2 rounded bg-[#f23f43] text-white text-[9px] font-bold shrink-0">
                <Tv className="w-2.5 h-2.5" />
                <span>LIVE</span>
              </span>
            )}
            {isGuildOwner && (
              <span title="Server Owner" className="shrink-0 flex items-center">
                <Crown className="w-3.5 h-3.5 text-[#f0b232]" />
              </span>
            )}
          </div>
          {user?.global_name && user.global_name !== username && (
            <div className="text-[11px] text-[#949ba4] truncate -mt-0.5">
              @{username}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <aside
      aria-label="Server members"
      className="w-60 min-w-[240px] max-w-[240px] h-full bg-[#2b2d31] flex flex-col py-4 px-2 select-none overflow-y-auto border-l border-[#1f2023]/60 no-scrollbar z-10"
    >
      {/* ONLINE Group */}
      {onlineMembers.length > 0 && (
        <div className="mb-4">
          <h3 className="px-2 pb-1 text-[11px] font-bold tracking-wider text-[#949ba4] uppercase">
            Online — {onlineMembers.length}
          </h3>
          <div className="space-y-0.5">
            {onlineMembers.map(renderMemberItem)}
          </div>
        </div>
      )}

      {/* OFFLINE Group */}
      {offlineMembers.length > 0 && (
        <div>
          <h3 className="px-2 pb-1 text-[11px] font-bold tracking-wider text-[#949ba4] uppercase">
            Offline — {offlineMembers.length}
          </h3>
          <div className="space-y-0.5">
            {offlineMembers.map(renderMemberItem)}
          </div>
        </div>
      )}

      {members.length === 0 && (
        <div className="p-4 text-center text-xs text-[#949ba4]">
          Loading members...
        </div>
      )}
    </aside>
  );
};
