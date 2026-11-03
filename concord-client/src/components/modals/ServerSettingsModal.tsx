import React, { useState, useEffect, FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useGuildStore, EMPTY_MEMBERS, EMPTY_ROLES } from "../../stores/guildStore";
import { useAuthStore } from "../../stores/authStore";
import { Role, Member, Ban, Permissions } from "../../types";
import {
  X,
  Loader2,
  Settings,
  Shield,
  Users,
  Ban as BanIcon,
  Plus,
  Trash2,
  Check,
  UserMinus,
  AlertCircle,
} from "lucide-react";

interface ServerSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  guildId: string;
}

type TabType = "overview" | "roles" | "members" | "bans";

const PERMISSION_OPTIONS: Array<{ key: string; label: string; desc: string; bit: bigint }> = [
  {
    key: "admin",
    label: "Administrador",
    desc: "Membros com esta permissão têm acesso completo a todos os canais e configurações do servidor.",
    bit: Permissions.ADMINISTRATOR,
  },
  {
    key: "manage_guild",
    label: "Gerenciar Servidor",
    desc: "Permite alterar o nome e o ícone do servidor.",
    bit: Permissions.MANAGE_GUILD,
  },
  {
    key: "manage_roles",
    label: "Gerenciar Cargos",
    desc: "Permite criar novos cargos e alterar permissões de cargos inferiores.",
    bit: Permissions.MANAGE_ROLES,
  },
  {
    key: "manage_channels",
    label: "Gerenciar Canais",
    desc: "Permite criar, editar e excluir canais de texto e voz.",
    bit: Permissions.MANAGE_CHANNELS,
  },
  {
    key: "kick_members",
    label: "Expulsar Membros",
    desc: "Permite remover membros do servidor.",
    bit: Permissions.KICK_MEMBERS,
  },
  {
    key: "ban_members",
    label: "Banir Membros",
    desc: "Permite banir membros permanentemente do servidor.",
    bit: Permissions.BAN_MEMBERS,
  },
  {
    key: "send_messages",
    label: "Enviar Mensagens",
    desc: "Permite enviar mensagens em canais de texto.",
    bit: Permissions.SEND_MESSAGES,
  },
  {
    key: "connect",
    label: "Conectar em Voz",
    desc: "Permite entrar nos canais de voz.",
    bit: Permissions.CONNECT,
  },
  {
    key: "speak",
    label: "Falar em Voz",
    desc: "Permite falar nos canais de voz.",
    bit: Permissions.SPEAK,
  },
  {
    key: "mute_members",
    label: "Mutar Membros",
    desc: "Permite mutar outros membros no canal de voz.",
    bit: Permissions.MUTE_MEMBERS,
  },
  {
    key: "deafen_members",
    label: "Ensurdecer Membros",
    desc: "Permite ensurdecer outros membros no canal de voz.",
    bit: Permissions.DEAFEN_MEMBERS,
  },
];

export const ServerSettingsModal: React.FC<ServerSettingsModalProps> = ({
  open,
  onOpenChange,
  guildId,
}) => {
  const { user: currentUser } = useAuthStore();
  const guilds = useGuildStore((s) => s.guilds);
  const currentGuild = guilds.find((g) => g.id === guildId);

  const membersByGuild = useGuildStore((s) => s.membersByGuild);
  const rolesByGuild = useGuildStore((s) => s.rolesByGuild);
  const members = membersByGuild[guildId] || EMPTY_MEMBERS;
  const roles = rolesByGuild[guildId] || EMPTY_ROLES;

  const {
    updateGuild,
    deleteGuild,
    fetchRoles,
    fetchMembers,
    createRole,
    updateRole,
    deleteRole,
    addMemberRole,
    removeMemberRole,
    kickMember,
    banMember,
    unbanMember,
    fetchBans,
  } = useGuildStore();

  const [activeTab, setActiveTab] = useState<TabType>("overview");

  // Overview state
  const [guildName, setGuildName] = useState("");
  const [guildIcon, setGuildIcon] = useState("");
  const [isSavingOverview, setIsSavingOverview] = useState(false);
  const [overviewSuccess, setOverviewSuccess] = useState(false);

  // Roles state
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [roleName, setRoleName] = useState("");
  const [roleColor, setRoleColor] = useState("#99aab5");
  const [rolePermsBigInt, setRolePermsBigInt] = useState<bigint>(0n);
  const [isSavingRole, setIsSavingRole] = useState(false);
  const [roleSuccess, setRoleSuccess] = useState(false);

  // Bans state
  const [bans, setBans] = useState<Ban[]>([]);
  const [isLoadingBans, setIsLoadingBans] = useState(false);

  // Member search & moderation state
  const [memberSearch, setMemberSearch] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const isOwner = currentGuild?.owner_id === currentUser?.id;

  // On open, load roles and members
  useEffect(() => {
    if (open && guildId) {
      if (currentGuild) {
        setGuildName(currentGuild.name);
        setGuildIcon(currentGuild.icon || "");
      }
      fetchRoles(guildId);
      fetchMembers(guildId);
      setActionError(null);
    }
  }, [open, guildId, currentGuild, fetchRoles, fetchMembers]);

  // Load bans when tab changes to bans
  useEffect(() => {
    if (open && activeTab === "bans" && guildId) {
      setIsLoadingBans(true);
      fetchBans(guildId)
        .then((b) => setBans(b))
        .catch((err) => console.error("Failed to load bans:", err))
        .finally(() => setIsLoadingBans(false));
    }
  }, [open, activeTab, guildId, fetchBans]);

  // Sync selected role
  useEffect(() => {
    if (roles.length > 0 && !selectedRoleId) {
      setSelectedRoleId(roles[0].id);
    }
  }, [roles, selectedRoleId]);

  const selectedRole = roles.find((r) => r.id === selectedRoleId);

  useEffect(() => {
    if (selectedRole) {
      setRoleName(selectedRole.name);
      const hex = selectedRole.color
        ? `#${selectedRole.color.toString(16).padStart(6, "0")}`
        : "#99aab5";
      setRoleColor(hex);
      try {
        setRolePermsBigInt(BigInt(selectedRole.permissions || "0"));
      } catch {
        setRolePermsBigInt(0n);
      }
      setRoleSuccess(false);
    }
  }, [selectedRole]);

  // Save server overview
  const handleSaveOverview = async (e: FormEvent) => {
    e.preventDefault();
    if (!guildName.trim()) return;

    setIsSavingOverview(true);
    setActionError(null);
    try {
      await updateGuild(guildId, {
        name: guildName.trim(),
        icon: guildIcon.trim() || null,
      });
      setOverviewSuccess(true);
      setTimeout(() => setOverviewSuccess(false), 2000);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Erro ao atualizar servidor");
    } finally {
      setIsSavingOverview(false);
    }
  };

  // Create new role
  const handleCreateRole = async () => {
    setActionError(null);
    try {
      const newRole = await createRole(guildId, {
        name: "novo cargo",
        color: 0x99aab5,
        permissions: "0",
      });
      setSelectedRoleId(newRole.id);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Erro ao criar cargo");
    }
  };

  // Save role edits
  const handleSaveRole = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedRole) return;

    setIsSavingRole(true);
    setActionError(null);
    try {
      const colorInt = parseInt(roleColor.replace("#", ""), 16) || 0;
      await updateRole(guildId, selectedRole.id, {
        name: roleName.trim(),
        color: colorInt,
        permissions: rolePermsBigInt.toString(),
      });
      setRoleSuccess(true);
      setTimeout(() => setRoleSuccess(false), 2000);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Erro ao atualizar cargo");
    } finally {
      setIsSavingRole(false);
    }
  };

  // Delete role
  const handleDeleteRole = async (roleId: string) => {
    if (!confirm("Tem certeza que deseja excluir este cargo?")) return;
    setActionError(null);
    try {
      await deleteRole(guildId, roleId);
      const remaining = roles.filter((r) => r.id !== roleId);
      if (remaining.length > 0) {
        setSelectedRoleId(remaining[0].id);
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Erro ao excluir cargo");
    }
  };

  // Toggle permission bit
  const handleTogglePerm = (bit: bigint) => {
    if ((rolePermsBigInt & bit) === bit) {
      setRolePermsBigInt(rolePermsBigInt & ~bit);
    } else {
      setRolePermsBigInt(rolePermsBigInt | bit);
    }
  };

  // Kick member
  const handleKick = async (member: Member) => {
    const name = member.nick || member.user?.global_name || member.user?.username;
    if (!confirm(`Expulsar ${name} do servidor?`)) return;

    setActionError(null);
    try {
      await kickMember(guildId, member.user_id);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Erro ao expulsar membro");
    }
  };

  // Ban member
  const handleBan = async (member: Member) => {
    const name = member.nick || member.user?.global_name || member.user?.username;
    const reason = prompt(`Motivo do banimento para ${name}:`, "Violação das regras");
    if (reason === null) return;

    setActionError(null);
    try {
      await banMember(guildId, member.user_id, {
        reason: reason || undefined,
        delete_message_days: 1,
      });
      // Refresh bans list if loaded
      const bList = await fetchBans(guildId);
      setBans(bList);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Erro ao banir membro");
    }
  };

  // Revoke ban
  const handleUnban = async (userId: string) => {
    setActionError(null);
    try {
      await unbanMember(guildId, userId);
      setBans((prev) => prev.filter((b) => b.user.id !== userId));
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Erro ao revogar ban");
    }
  };

  // Toggle role assignment for a member
  const handleToggleMemberRole = async (member: Member, roleId: string) => {
    const hasRole = (member.roles || []).includes(roleId);
    setActionError(null);
    try {
      if (hasRole) {
        await removeMemberRole(guildId, member.user_id, roleId);
      } else {
        await addMemberRole(guildId, member.user_id, roleId);
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Erro ao alterar cargo do membro");
    }
  };

  const filteredMembers = members.filter((m) => {
    const search = memberSearch.toLowerCase();
    const uname = (m.user?.username || "").toLowerCase();
    const gname = (m.user?.global_name || "").toLowerCase();
    const nick = (m.nick || "").toLowerCase();
    return uname.includes(search) || gname.includes(search) || nick.includes(search);
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 animate-in fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl h-[650px] bg-[#313338] text-white rounded-lg shadow-2xl overflow-hidden z-50 flex border border-[#232428] animate-in fade-in-0 zoom-in-95">
          {/* Modal Sidebar */}
          <div className="w-56 bg-[#2b2d31] p-4 flex flex-col justify-between shrink-0 border-r border-[#232428]">
            <div className="space-y-1">
              <div className="px-2 py-1 text-xs font-bold text-[#949ba4] uppercase tracking-wider mb-2 truncate">
                {currentGuild?.name || "Servidor"}
              </div>

              <button
                type="button"
                onClick={() => { setActiveTab("overview"); setActionError(null); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded text-sm font-medium transition ${
                  activeTab === "overview"
                    ? "bg-[#404249] text-white"
                    : "text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]"
                }`}
              >
                <Settings className="w-4 h-4" />
                Visão Geral
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab("roles"); setActionError(null); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded text-sm font-medium transition ${
                  activeTab === "roles"
                    ? "bg-[#404249] text-white"
                    : "text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]"
                }`}
              >
                <Shield className="w-4 h-4" />
                Cargos ({roles.length})
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab("members"); setActionError(null); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded text-sm font-medium transition ${
                  activeTab === "members"
                    ? "bg-[#404249] text-white"
                    : "text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]"
                }`}
              >
                <Users className="w-4 h-4" />
                Membros ({members.length})
              </button>

              <button
                type="button"
                onClick={() => { setActiveTab("bans"); setActionError(null); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded text-sm font-medium transition ${
                  activeTab === "bans"
                    ? "bg-[#404249] text-white"
                    : "text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]"
                }`}
              >
                <BanIcon className="w-4 h-4" />
                Banimentos
              </button>
            </div>

            {isOwner && (
              <div className="pt-4 border-t border-[#35373c]">
                <button
                  type="button"
                  onClick={async () => {
                    if (confirm("ATENÇÃO: Deseja realmente excluir este servidor? Esta ação é irreversível.")) {
                      try {
                        await deleteGuild(guildId);
                        onOpenChange(false);
                      } catch (err) {
                        alert(err instanceof Error ? err.message : "Erro ao excluir servidor");
                      }
                    }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-[#f23f43] hover:bg-[#f23f43]/10 rounded transition"
                >
                  <Trash2 className="w-4 h-4" />
                  Excluir Servidor
                </button>
              </div>
            )}
          </div>

          {/* Modal Main Content */}
          <div className="flex-1 flex flex-col bg-[#313338] relative overflow-hidden">
            {/* Header with Close */}
            <div className="p-4 border-b border-[#232428] flex items-center justify-between shrink-0">
              <Dialog.Title className="text-lg font-bold text-white flex items-center gap-2">
                {activeTab === "overview" && "Visão Geral do Servidor"}
                {activeTab === "roles" && "Gerenciamento de Cargos"}
                {activeTab === "members" && "Membros do Servidor"}
                {activeTab === "bans" && "Usuários Banidos"}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="text-[#949ba4] hover:text-white p-1 rounded transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </Dialog.Close>
            </div>

            {/* Error banner */}
            {actionError && (
              <div className="mx-6 mt-4 p-3 bg-[#f23f43]/15 border border-[#f23f43]/40 rounded text-[#fa777a] text-xs flex items-center gap-2 shrink-0">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}

            {/* Tab: Overview */}
            {activeTab === "overview" && (
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <form onSubmit={handleSaveOverview} className="space-y-5 max-w-lg">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-[#b5bac1] mb-2">
                      Nome do Servidor
                    </label>
                    <input
                      type="text"
                      value={guildName}
                      onChange={(e) => setGuildName(e.target.value)}
                      className="w-full bg-[#1e1f22] text-white px-3.5 py-2.5 rounded text-sm border border-transparent focus:border-[#5865f2] focus:outline-none transition"
                      placeholder="Nome do servidor"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-[#b5bac1] mb-2">
                      URL do Ícone
                    </label>
                    <input
                      type="url"
                      value={guildIcon}
                      onChange={(e) => setGuildIcon(e.target.value)}
                      className="w-full bg-[#1e1f22] text-white px-3.5 py-2.5 rounded text-sm border border-transparent focus:border-[#5865f2] focus:outline-none transition"
                      placeholder="https://exemplo.com/icone.png"
                    />
                  </div>

                  {guildIcon && (
                    <div className="flex items-center gap-3 pt-2">
                      <span className="text-xs text-[#949ba4]">Pré-visualização:</span>
                      <img
                        src={guildIcon}
                        alt="Preview"
                        className="w-12 h-12 rounded-full object-cover border border-[#404249]"
                        onError={(e) => { (e.target as HTMLElement).style.display = "none"; }}
                      />
                    </div>
                  )}

                  <div className="pt-4 flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={isSavingOverview}
                      className="px-5 py-2.5 bg-[#5865f2] hover:bg-[#4752c4] text-white font-medium text-sm rounded transition flex items-center gap-2 disabled:opacity-50"
                    >
                      {isSavingOverview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Salvar Alterações
                    </button>
                    {overviewSuccess && (
                      <span className="text-xs text-[#23a55a] font-medium flex items-center gap-1">
                        <Check className="w-4 h-4" /> Alterações salvas!
                      </span>
                    )}
                  </div>
                </form>
              </div>
            )}

            {/* Tab: Roles */}
            {activeTab === "roles" && (
              <div className="flex-1 flex overflow-hidden">
                {/* Roles List */}
                <div className="w-48 bg-[#2b2d31]/50 border-r border-[#232428] flex flex-col shrink-0">
                  <div className="p-3 border-b border-[#232428]">
                    <button
                      type="button"
                      onClick={handleCreateRole}
                      className="w-full py-1.5 px-2.5 bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold rounded flex items-center justify-center gap-1.5 transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Criar Cargo
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {roles.map((r) => {
                      const hexColor = r.color ? `#${r.color.toString(16).padStart(6, "0")}` : "#99aab5";
                      const isSelected = r.id === selectedRoleId;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setSelectedRoleId(r.id)}
                          className={`w-full text-left px-2.5 py-2 rounded text-xs font-medium flex items-center gap-2 transition ${
                            isSelected
                              ? "bg-[#404249] text-white"
                              : "text-[#949ba4] hover:bg-[#35373c] hover:text-[#dbdee1]"
                          }`}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: hexColor }}
                          />
                          <span className="truncate">{r.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Role Details Editor */}
                <div className="flex-1 overflow-y-auto p-6">
                  {selectedRole ? (
                    <form onSubmit={handleSaveRole} className="space-y-6">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-[#b5bac1] mb-2">
                            Nome do Cargo
                          </label>
                          <input
                            type="text"
                            value={roleName}
                            onChange={(e) => setRoleName(e.target.value)}
                            disabled={selectedRole.name === "@everyone"}
                            className="w-full bg-[#1e1f22] text-white px-3 py-2 rounded text-sm border border-transparent focus:border-[#5865f2] focus:outline-none transition disabled:opacity-50"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-[#b5bac1] mb-2">
                            Cor do Cargo
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={roleColor}
                              onChange={(e) => setRoleColor(e.target.value)}
                              className="w-10 h-9 bg-transparent border-0 rounded cursor-pointer"
                            />
                            <span className="text-xs text-[#949ba4] font-mono">{roleColor.toUpperCase()}</span>
                          </div>
                        </div>
                      </div>

                      {/* Permissions List */}
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-[#b5bac1] mb-3">
                          Permissões do Cargo
                        </h4>
                        <div className="space-y-2 border border-[#232428] rounded bg-[#2b2d31]/30 p-3 divide-y divide-[#35373c]/50">
                          {PERMISSION_OPTIONS.map((opt) => {
                            const isEnabled = (rolePermsBigInt & opt.bit) === opt.bit;
                            return (
                              <div
                                key={opt.key}
                                className="pt-2.5 first:pt-0 flex items-center justify-between gap-4 cursor-pointer"
                                onClick={() => handleTogglePerm(opt.bit)}
                              >
                                <div className="space-y-0.5">
                                  <div className="text-sm font-medium text-white">{opt.label}</div>
                                  <div className="text-xs text-[#949ba4]">{opt.desc}</div>
                                </div>
                                <input
                                  type="checkbox"
                                  checked={isEnabled}
                                  onChange={() => handleTogglePerm(opt.bit)}
                                  className="w-4 h-4 rounded text-[#5865f2] bg-[#1e1f22] border-[#404249] focus:ring-0 cursor-pointer shrink-0"
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="pt-2 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <button
                            type="submit"
                            disabled={isSavingRole}
                            className="px-4 py-2 bg-[#5865f2] hover:bg-[#4752c4] text-white text-xs font-semibold rounded transition flex items-center gap-1.5 disabled:opacity-50"
                          >
                            {isSavingRole ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            Salvar Cargo
                          </button>
                          {roleSuccess && (
                            <span className="text-xs text-[#23a55a] font-medium flex items-center gap-1">
                              <Check className="w-3.5 h-3.5" /> Salvo com sucesso!
                            </span>
                          )}
                        </div>

                        {selectedRole.name !== "@everyone" && (
                          <button
                            type="button"
                            onClick={() => handleDeleteRole(selectedRole.id)}
                            className="text-xs text-[#f23f43] hover:underline flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Excluir Cargo
                          </button>
                        )}
                      </div>
                    </form>
                  ) : (
                    <div className="text-sm text-[#949ba4]">Selecione ou crie um cargo.</div>
                  )}
                </div>
              </div>
            )}

            {/* Tab: Members */}
            {activeTab === "members" && (
              <div className="flex-1 flex flex-col overflow-hidden p-6">
                <div className="mb-4">
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Filtrar membros..."
                    className="w-full bg-[#1e1f22] text-white px-3.5 py-2 rounded text-sm border border-transparent focus:border-[#5865f2] focus:outline-none transition"
                  />
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {filteredMembers.map((m) => {
                    const isSelf = m.user_id === currentUser?.id;
                    const isTargetOwner = m.user_id === currentGuild?.owner_id;
                    const memberRoles = (m.roles || [])
                      .map((rid) => roles.find((r) => r.id === rid))
                      .filter((r): r is Role => Boolean(r && r.name !== "@everyone"));

                    return (
                      <div
                        key={m.user_id}
                        className="flex items-center justify-between p-3 rounded bg-[#2b2d31]/50 border border-[#232428] hover:bg-[#2b2d31] transition"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-[#5865f2] flex items-center justify-center font-bold text-sm shrink-0 overflow-hidden">
                            {m.user?.avatar ? (
                              <img src={m.user.avatar} alt="Avatar" className="w-full h-full object-cover" />
                            ) : (
                              (m.user?.username || "?")[0].toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-white truncate flex items-center gap-1.5">
                              <span>{m.nick || m.user?.global_name || m.user?.username}</span>
                              {isTargetOwner && (
                                <span className="text-[10px] bg-[#f0b232]/20 text-[#f0b232] px-1.5 py-0.5 rounded font-bold">
                                  DONO
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-[#949ba4] truncate">@{m.user?.username}</div>

                            {/* Assigned Role Badges */}
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {memberRoles.map((r) => {
                                const hex = r.color ? `#${r.color.toString(16).padStart(6, "0")}` : "#99aab5";
                                return (
                                  <span
                                    key={r.id}
                                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1 border"
                                    style={{
                                      borderColor: `${hex}60`,
                                      backgroundColor: `${hex}20`,
                                      color: hex,
                                    }}
                                  >
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: hex }} />
                                    {r.name}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        {/* Member Actions */}
                        <div className="flex items-center gap-2 shrink-0">
                          {/* Role Toggle Dropdown / Selector */}
                          <select
                            className="bg-[#1e1f22] text-xs text-[#dbdee1] border border-[#35373c] rounded px-2 py-1 focus:outline-none"
                            value=""
                            onChange={(e) => {
                              if (e.target.value) {
                                handleToggleMemberRole(m, e.target.value);
                              }
                            }}
                          >
                            <option value="">+ / - Cargo...</option>
                            {roles
                              .filter((r) => r.name !== "@everyone")
                              .map((r) => {
                                const hasRole = (m.roles || []).includes(r.id);
                                return (
                                  <option key={r.id} value={r.id}>
                                    {hasRole ? `✓ Remover ${r.name}` : `+ Adicionar ${r.name}`}
                                  </option>
                                );
                              })}
                          </select>

                          {!isSelf && !isTargetOwner && (
                            <>
                              <button
                                type="button"
                                title="Expulsar"
                                onClick={() => handleKick(m)}
                                className="p-1.5 text-[#949ba4] hover:text-[#f23f43] hover:bg-[#f23f43]/10 rounded transition"
                              >
                                <UserMinus className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                title="Banir"
                                onClick={() => handleBan(m)}
                                className="p-1.5 text-[#949ba4] hover:text-[#f23f43] hover:bg-[#f23f43]/10 rounded transition"
                              >
                                <BanIcon className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tab: Bans */}
            {activeTab === "bans" && (
              <div className="flex-1 overflow-y-auto p-6">
                {isLoadingBans ? (
                  <div className="flex items-center justify-center h-48 text-[#949ba4]">
                    <Loader2 className="w-6 h-6 animate-spin mr-2" /> Carregando banimentos...
                  </div>
                ) : bans.length === 0 ? (
                  <div className="text-center py-12 text-[#949ba4] text-sm">
                    Nenhum membro banido deste servidor.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {bans.map((b) => (
                      <div
                        key={b.user.id}
                        className="flex items-center justify-between p-3 rounded bg-[#2b2d31]/50 border border-[#232428]"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-[#f23f43]/20 flex items-center justify-center font-bold text-sm text-[#f23f43]">
                            {(b.user.username || "?")[0].toUpperCase()}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white">
                              {b.user.global_name || b.user.username}
                              <span className="text-xs text-[#949ba4] ml-1.5">@{b.user.username}</span>
                            </div>
                            <div className="text-xs text-[#fa777a] mt-0.5">
                              Motivo: {b.reason || "Nenhum motivo especificado"}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleUnban(b.user.id)}
                          className="px-3 py-1.5 text-xs font-semibold bg-[#2b2d31] hover:bg-[#35373c] text-[#dbdee1] border border-[#35373c] rounded transition"
                        >
                          Revogar Ban
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
