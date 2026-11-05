import React, { useMemo, useState } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { useGuildStore, EMPTY_MEMBERS, EMPTY_ROLES } from "../../stores/guildStore";
import { useAuthStore } from "../../stores/authStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { useVoiceStore, EMPTY_VOICE_STATES } from "../../stores/voiceStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useDMStore } from "../../stores/dmStore";
import { Member, UserStatus, Role } from "../../types";
import {
  Crown,
  Tv,
  Shield,
  UserMinus,
  Ban as BanIcon,
  Check,
  ChevronRight,
  User as UserIcon,
  Copy,
  Volume2,
  VolumeX,
  MessageSquare,
} from "lucide-react";
import { UserProfileModal } from "../modals/UserProfileModal";
import { useProfileModalStore } from "../../stores/profileModalStore";

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
  const { user: currentUser } = useAuthStore();
  const [profileMember, setProfileMember] = useState<Member | null>(null);

  const {
    guilds,
    membersByGuild,
    rolesByGuild,
    kickMember,
    banMember,
    addMemberRole,
    removeMemberRole,
    selectGuild,
  } = useGuildStore();

  const openDM = useDMStore((s) => s.openDM);

  const presences = usePresenceStore((s) => s.presences);
  const rawVoiceStates = useVoiceStore((s) => s.voiceStatesByGuild[guildId]);
  const voiceStates = rawVoiceStates || EMPTY_VOICE_STATES;
  const syncUserAudio = useVoiceStore((s) => s.syncUserAudio);
  const speakingUserIds = useVoiceStore((s) => s.speakingUserIds);

  const userVolumes = useSettingsStore((s) => s.userVolumes);
  const localMutedUsers = useSettingsStore((s) => s.localMutedUsers);
  const setUserVolume = useSettingsStore((s) => s.setUserVolume);
  const toggleLocalMute = useSettingsStore((s) => s.toggleLocalMute);

  const currentGuild = guilds.find((g) => g.id === guildId);
  const members = membersByGuild[guildId] || EMPTY_MEMBERS;
  const roles = rolesByGuild[guildId] || EMPTY_ROLES;

  const isCallerOwner = currentGuild?.owner_id === currentUser?.id;

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

  // Determine member's highest role color
  const getMemberColor = (memberRoles?: string[]): string | undefined => {
    if (!memberRoles || memberRoles.length === 0) return undefined;
    const assignedRoles = memberRoles
      .map((rid) => roles.find((r) => r.id === rid))
      .filter((r): r is Role => Boolean(r && r.color > 0))
      .sort((a, b) => b.position - a.position);

    if (assignedRoles.length > 0) {
      return `#${assignedRoles[0].color.toString(16).padStart(6, "0")}`;
    }
    return undefined;
  };

  const handleKick = async (member: Member) => {
    const name = member.nick || member.user?.global_name || member.user?.username;
    if (confirm(`Expulsar ${name} do servidor?`)) {
      try {
        await kickMember(guildId, member.user_id);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Erro ao expulsar membro");
      }
    }
  };

  const handleBan = async (member: Member) => {
    const name = member.nick || member.user?.global_name || member.user?.username;
    const reason = prompt(`Motivo do banimento para ${name}:`, "Violação das regras");
    if (reason !== null) {
      try {
        await banMember(guildId, member.user_id, {
          reason: reason || undefined,
          delete_message_days: 1,
        });
      } catch (err) {
        alert(err instanceof Error ? err.message : "Erro ao banir membro");
      }
    }
  };

  const handleToggleRole = async (member: Member, roleId: string) => {
    const hasRole = (member.roles || []).includes(roleId);
    try {
      if (hasRole) {
        await removeMemberRole(guildId, member.user_id, roleId);
      } else {
        await addMemberRole(guildId, member.user_id, roleId);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao atualizar cargo");
    }
  };

  const renderMemberItem = (item: { member: Member; status: UserStatus }) => {
    const { member, status } = item;
    const user = member.user;
    const displayName = member.nick || user?.global_name || user?.username || "Unknown";
    const username = user?.username || "";
    const isGuildOwner = isOwner(member.user_id);
    const isSelf = member.user_id === currentUser?.id;
    const roleColor = getMemberColor(member.roles);
    const speaking = speakingUserIds.includes(member.user_id);

    const memberRoles = roles.filter((r: Role) => (member.roles || []).includes(r.id));
    const openProfile = useProfileModalStore.getState().openProfile;

    const handleOpenProfile = () => {
      if (user) {
        openProfile(user, {
          nick: member.nick,
          joinedAt: member.joined_at,
          roles: memberRoles,
        });
      }
    };

    return (
      <ContextMenu.Root key={member.user_id}>
        <ContextMenu.Trigger asChild>
          <div
            onClick={handleOpenProfile}
            className="group flex items-center gap-3 px-2 py-1.5 rounded-[4px] hover:bg-[#35373c]/60 cursor-pointer transition-colors"
          >
            {/* Avatar with status indicator */}
            <div className="relative shrink-0">
              <div
                className={`w-8 h-8 rounded-full bg-[#5865F2] flex items-center justify-center text-xs font-semibold text-white overflow-hidden transition-all duration-150 ${
                  speaking ? "ring-2 ring-[#23a55a] shadow-[0_0_8px_#23a55a]" : ""
                }`}
              >
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
                  style={roleColor ? { color: roleColor } : undefined}
                  className={`text-sm font-medium truncate ${
                    roleColor
                      ? ""
                      : status === "offline"
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
                  <span title="Dono do Servidor" className="shrink-0 flex items-center">
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
        </ContextMenu.Trigger>

        {/* Right-click Context Menu */}
        <ContextMenu.Portal>
          <ContextMenu.Content className="w-56 bg-[#111214] border border-[#2b2d31] p-1.5 rounded-md shadow-xl text-sm font-medium z-50 text-[#dbdee1] animate-in fade-in-0 zoom-in-95">
            <div className="px-2 py-1 text-xs font-bold text-[#949ba4] uppercase truncate">
              {displayName}
            </div>
            <ContextMenu.Separator className="h-[1px] bg-[#2b2d31] my-1" />

            {/* Profile Action */}
            <ContextMenu.Item
              onClick={handleOpenProfile}
              className="flex items-center justify-between px-2.5 py-1.5 rounded text-xs hover:bg-[#5865F2] hover:text-white cursor-pointer transition-colors outline-none"
            >
              <span>Ver Perfil</span>
              <UserIcon className="w-3.5 h-3.5" />
            </ContextMenu.Item>

            {/* Direct Message Action */}
            {!isSelf && (
              <ContextMenu.Item
                onClick={async () => {
                  try {
                    await openDM(member.user_id);
                    selectGuild("");
                  } catch (err) {
                    console.error("Failed to open DM:", err);
                  }
                }}
                className="flex items-center justify-between px-2.5 py-1.5 rounded text-xs hover:bg-[#5865F2] hover:text-white cursor-pointer transition-colors outline-none"
              >
                <span>Enviar Mensagem Direta</span>
                <MessageSquare className="w-3.5 h-3.5" />
              </ContextMenu.Item>
            )}

            {/* Copy ID Action */}
            <ContextMenu.Item
              onClick={() => {
                navigator.clipboard.writeText(member.user_id);
              }}
              className="flex items-center justify-between px-2.5 py-1.5 rounded text-xs hover:bg-[#5865F2] hover:text-white cursor-pointer transition-colors outline-none"
            >
              <span>Copiar ID do Usuário</span>
              <Copy className="w-3.5 h-3.5" />
            </ContextMenu.Item>

            {/* Individual Audio Controls (if not self) */}
            {!isSelf && (
              <>
                <ContextMenu.Separator className="h-[1px] bg-[#2b2d31] my-1" />

                {/* Local Volume Slider 0% - 200% */}
                <div className="px-2.5 py-2 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-[#dbdee1] font-medium">
                      <Volume2 className="w-3.5 h-3.5 text-[#949ba4]" />
                      Volume do Usuário
                    </span>
                    <span className="text-white font-bold text-[11px]">
                      {userVolumes[member.user_id] !== undefined
                        ? userVolumes[member.user_id]
                        : 100}
                      %
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="200"
                    value={
                      userVolumes[member.user_id] !== undefined
                        ? userVolumes[member.user_id]
                        : 100
                    }
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setUserVolume(member.user_id, val);
                      syncUserAudio(member.user_id);
                    }}
                    className="w-full accent-[#5865F2] cursor-pointer h-1.5"
                  />
                </div>

                {/* Local Mute Toggle */}
                <ContextMenu.Item
                  onClick={() => {
                    toggleLocalMute(member.user_id);
                    syncUserAudio(member.user_id);
                  }}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs cursor-pointer transition-colors outline-none ${
                    localMutedUsers[member.user_id]
                      ? "text-[#f23f43] bg-[#f23f43]/10"
                      : "hover:bg-[#5865F2] hover:text-white"
                  }`}
                >
                  <span>
                    {localMutedUsers[member.user_id]
                      ? "Desmutar localmente"
                      : "Mutar localmente"}
                  </span>
                  <VolumeX className="w-3.5 h-3.5" />
                </ContextMenu.Item>
              </>
            )}

            {/* Roles Submenu */}
            {isCallerOwner && roles.filter((r) => r.name !== "@everyone").length > 0 && (
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger className="flex items-center justify-between px-2.5 py-1.5 rounded text-xs hover:bg-[#5865F2] hover:text-white cursor-pointer transition-colors outline-none">
                  <span className="flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5" />
                    Cargos
                  </span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent className="w-48 bg-[#111214] border border-[#2b2d31] p-1.5 rounded-md shadow-xl text-xs font-medium z-50 text-[#dbdee1]">
                    {roles
                      .filter((r) => r.name !== "@everyone")
                      .map((r) => {
                        const hasRole = (member.roles || []).includes(r.id);
                        const hex = r.color ? `#${r.color.toString(16).padStart(6, "0")}` : "#99aab5";
                        return (
                          <ContextMenu.Item
                            key={r.id}
                            onClick={() => handleToggleRole(member, r.id)}
                            className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-[#5865F2] hover:text-white cursor-pointer transition-colors outline-none"
                          >
                            <span className="flex items-center gap-2 truncate">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hex }} />
                              {r.name}
                            </span>
                            {hasRole && <Check className="w-3.5 h-3.5 text-[#23a55a]" />}
                          </ContextMenu.Item>
                        );
                      })}
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>
            )}

            {/* Moderation: Kick / Ban */}
            {isCallerOwner && !isSelf && !isGuildOwner && (
              <>
                <ContextMenu.Separator className="h-[1px] bg-[#2b2d31] my-1" />
                <ContextMenu.Item
                  onClick={() => handleKick(member)}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded text-xs text-[#f23f43] hover:bg-[#f23f43] hover:text-white cursor-pointer transition-colors outline-none"
                >
                  <span>Expulsar {displayName}</span>
                  <UserMinus className="w-3.5 h-3.5" />
                </ContextMenu.Item>
                <ContextMenu.Item
                  onClick={() => handleBan(member)}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded text-xs text-[#f23f43] hover:bg-[#f23f43] hover:text-white cursor-pointer transition-colors outline-none"
                >
                  <span>Banir {displayName}</span>
                  <BanIcon className="w-3.5 h-3.5" />
                </ContextMenu.Item>
              </>
            )}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
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
          Carregando membros...
        </div>
      )}

      {profileMember && profileMember.user && (
        <UserProfileModal
          open={Boolean(profileMember)}
          onOpenChange={(open) => {
            if (!open) setProfileMember(null);
          }}
          user={profileMember.user}
          nick={profileMember.nick}
          joinedAt={profileMember.joined_at}
          roles={(profileMember.roles || [])
            .map((rid) => roles.find((r) => r.id === rid))
            .filter((r): r is Role => Boolean(r && r.name !== "@everyone"))
            .map((r) => ({ id: r.id, name: r.name, color: r.color }))}
        />
      )}
    </aside>
  );
};
