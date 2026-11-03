import React, { useState, useMemo } from "react";
import { useRelationshipStore } from "../../stores/relationshipStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { useDMStore } from "../../stores/dmStore";
import { useGuildStore } from "../../stores/guildStore";
import { Relationship, RelationshipType, UserStatus } from "../../types";
import { ConcordLogo } from "../common/ConcordLogo";
import {
  Users,
  Search,
  MessageSquare,
  MoreVertical,
  Check,
  X,
  UserPlus,
  ShieldAlert,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

export type FriendsTab = "online" | "all" | "pending" | "blocked" | "add_friend";

interface FriendsViewProps {
  initialTab?: FriendsTab;
}

export const FriendsView: React.FC<FriendsViewProps> = ({
  initialTab = "online",
}) => {
  const [activeTab, setActiveTab] = useState<FriendsTab>(initialTab);
  const [searchQuery, setSearchQuery] = useState("");
  const [addUsername, setAddUsername] = useState("");
  const [addStatus, setAddStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const relationships = useRelationshipStore((s) => s.relationships);
  const sendFriendRequest = useRelationshipStore((s) => s.sendFriendRequest);
  const acceptRequest = useRelationshipStore((s) => s.acceptRequest);
  const removeRelationship = useRelationshipStore((s) => s.removeRelationship);
  const blockUser = useRelationshipStore((s) => s.blockUser);

  const presences = usePresenceStore((s) => s.presences);
  const openDM = useDMStore((s) => s.openDM);
  const selectGuild = useGuildStore((s) => s.selectGuild);

  // Filtered lists
  const friends = useMemo(
    () => relationships.filter((r) => r.type === RelationshipType.FRIEND),
    [relationships]
  );

  const onlineFriends = useMemo(() => {
    return friends.filter((f) => {
      const status = presences[f.user.id] || "offline";
      return status !== "offline";
    });
  }, [friends, presences]);

  const incomingRequests = useMemo(
    () => relationships.filter((r) => r.type === RelationshipType.PENDING_INCOMING),
    [relationships]
  );

  const outgoingRequests = useMemo(
    () => relationships.filter((r) => r.type === RelationshipType.PENDING_OUTGOING),
    [relationships]
  );

  const blockedUsers = useMemo(
    () => relationships.filter((r) => r.type === RelationshipType.BLOCKED),
    [relationships]
  );

  const handleOpenDM = async (userId: string) => {
    try {
      await openDM(userId);
      selectGuild("");
    } catch (err) {
      console.error("Failed to open DM:", err);
    }
  };

  const handleSendFriendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addUsername.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setAddStatus(null);
    try {
      await sendFriendRequest(addUsername.trim());
      setAddStatus({
        type: "success",
        message: `Pedido de amizade enviado para ${addUsername.trim()}!`,
      });
      setAddUsername("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Falha ao enviar pedido de amizade";
      setAddStatus({
        type: "error",
        message: msg,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusColor = (status: UserStatus) => {
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

  const getStatusLabel = (status: UserStatus) => {
    switch (status) {
      case "online":
        return "Disponível";
      case "idle":
        return "Ausente";
      case "dnd":
        return "Não Perturbe";
      case "offline":
      default:
        return "Offline";
    }
  };

  // Filter current list by search query
  const filterList = (list: Relationship[]) => {
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (r) =>
        r.user.username.toLowerCase().includes(q) ||
        (r.user.global_name && r.user.global_name.toLowerCase().includes(q))
    );
  };

  return (
    <div className="flex-1 h-full bg-[#313338] flex flex-col overflow-hidden select-none">
      {/* 1. Friends Top Navigation Header (48px) */}
      <header className="h-12 min-h-[48px] border-b border-[#1f2023] px-4 flex items-center justify-between shadow-sm bg-[#313338] text-sm font-medium z-10">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-2 text-[#dbdee1] font-bold text-[15px] shrink-0">
            <Users className="w-5 h-5 text-[#949ba4]" />
            <span>Amigos</span>
          </div>

          <div className="w-[1px] h-4 bg-[#3f4147] shrink-0" />

          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 text-[#b5bac1] text-[13px] font-semibold overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setActiveTab("online")}
              className={`px-2.5 py-1 rounded-[4px] transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === "online"
                  ? "bg-[#404249] text-white"
                  : "hover:bg-[#35373c] hover:text-[#dbdee1]"
              }`}
            >
              <span>Disponível</span>
              {onlineFriends.length > 0 && (
                <span className="text-[11px] opacity-80">({onlineFriends.length})</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("all")}
              className={`px-2.5 py-1 rounded-[4px] transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === "all"
                  ? "bg-[#404249] text-white"
                  : "hover:bg-[#35373c] hover:text-[#dbdee1]"
              }`}
            >
              <span>Todos</span>
              {friends.length > 0 && (
                <span className="text-[11px] opacity-80">({friends.length})</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("pending")}
              className={`relative px-2.5 py-1 rounded-[4px] transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === "pending"
                  ? "bg-[#404249] text-white"
                  : "hover:bg-[#35373c] hover:text-[#dbdee1]"
              }`}
            >
              <span>Pendentes</span>
              {incomingRequests.length > 0 ? (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-[#f23f43] text-white">
                  {incomingRequests.length}
                </span>
              ) : outgoingRequests.length > 0 ? (
                <span className="text-[11px] opacity-80">({outgoingRequests.length})</span>
              ) : null}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("blocked")}
              className={`px-2.5 py-1 rounded-[4px] transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === "blocked"
                  ? "bg-[#404249] text-white"
                  : "hover:bg-[#35373c] hover:text-[#dbdee1]"
              }`}
            >
              <span>Bloqueados</span>
              {blockedUsers.length > 0 && (
                <span className="text-[11px] opacity-80">({blockedUsers.length})</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("add_friend")}
              className={`px-2.5 py-1 rounded-[4px] font-bold transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === "add_friend"
                  ? "bg-[#23a55a] text-white"
                  : "text-[#23a55a] hover:bg-[#23a55a]/15"
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Adicionar Amigo</span>
            </button>
          </div>
        </div>
      </header>

      {/* 2. Main Tab Body */}
      <div className="flex-1 overflow-y-auto p-6 min-h-0">
        {/* ADD FRIEND TAB */}
        {activeTab === "add_friend" ? (
          <div className="max-w-xl mx-auto py-4 space-y-6">
            <div>
              <h2 className="text-white text-base font-bold tracking-wide uppercase">
                Adicionar Amigo
              </h2>
              <p className="text-xs text-[#949ba4] mt-1">
                Você pode adicionar amigos usando o nome de usuário do Concord.
              </p>
            </div>

            <form onSubmit={handleSendFriendRequest} className="space-y-4">
              <div className="relative flex items-center bg-[#1e1f22] rounded-lg p-3 border border-[#1f2023] focus-within:border-[#23a55a] transition">
                <input
                  type="text"
                  value={addUsername}
                  onChange={(e) => setAddUsername(e.target.value)}
                  placeholder="Insira o nome de usuário (ex: amigo)"
                  className="bg-transparent flex-1 text-sm text-white focus:outline-none placeholder-[#80848e]"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!addUsername.trim() || isSubmitting}
                  className="ml-3 bg-[#23a55a] hover:bg-[#1f9250] disabled:bg-[#23a55a]/50 text-white text-xs font-semibold px-4 py-2 rounded-md transition cursor-pointer shrink-0"
                >
                  {isSubmitting ? "Enviando..." : "Enviar pedido de amizade"}
                </button>
              </div>

              {addStatus && (
                <div
                  className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 animate-in fade-in-0 ${
                    addStatus.type === "success"
                      ? "bg-[#23a55a]/15 text-[#23a55a] border border-[#23a55a]/30"
                      : "bg-[#f23f43]/15 text-[#f23f43] border border-[#f23f43]/30"
                  }`}
                >
                  {addStatus.type === "success" ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{addStatus.message}</span>
                </div>
              )}
            </form>

            <div className="pt-8 border-t border-[#35373c] flex flex-col items-center justify-center text-center">
              <ConcordLogo size={100} variant="mascot" eyeColor="#1FCE66" bodyColor="#FFFFFF" />
              <p className="text-xs text-[#949ba4] mt-4 max-w-sm">
                O Concord está esperando por novos amigos. Convide as pessoas para começar a bater papo!
              </p>
            </div>
          </div>
        ) : (
          /* LIST TABS: ONLINE, ALL, PENDING, BLOCKED */
          <div className="space-y-4 max-w-5xl mx-auto">
            {/* Search Input Filter */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar"
                className="w-full bg-[#1e1f22] text-sm text-white px-3 py-2 pl-9 rounded-[4px] border border-[#1f2023] focus:outline-none focus:border-[#5865F2] placeholder-[#80848e]"
              />
              <Search className="w-4 h-4 text-[#80848e] absolute left-3 top-1/2 -translate-y-1/2" />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#80848e] hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* TAB: ONLINE */}
            {activeTab === "online" && (
              <div>
                <div className="text-[12px] font-bold tracking-wider text-[#949ba4] uppercase pb-2">
                  DISPONÍVEL — {filterList(onlineFriends).length}
                </div>
                {filterList(onlineFriends).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-[#949ba4]">
                    <ConcordLogo size={64} variant="mascot" eyeColor="#1FCE66" bodyColor="#FFFFFF" />
                    <p className="mt-4 text-sm font-medium text-[#dbdee1]">
                      Nenhum amigo está disponível no momento.
                    </p>
                    <p className="text-xs text-[#80848e] mt-1">
                      Quando seus amigos ficarem online, eles aparecerão aqui.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#35373c]/50">
                    {filterList(onlineFriends).map((rel) => {
                      const status = presences[rel.user.id] || "online";
                      const displayName = rel.user.global_name || rel.user.username;
                      return (
                        <div
                          key={rel.id}
                          className="group flex items-center justify-between py-2.5 px-3 hover:bg-[#35373c]/40 rounded-lg transition"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="relative shrink-0">
                              <div className="w-10 h-10 rounded-full bg-[#5865F2] flex items-center justify-center text-white font-bold text-sm overflow-hidden">
                                {rel.user.avatar ? (
                                  <img
                                    src={rel.user.avatar}
                                    alt={displayName}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  displayName.slice(0, 2).toUpperCase()
                                )}
                              </div>
                              <span
                                className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-[2.5px] border-[#313338] ${getStatusColor(
                                  status
                                )}`}
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white flex items-center gap-1.5 truncate">
                                <span>{displayName}</span>
                                {rel.user.global_name && (
                                  <span className="text-xs font-normal text-[#949ba4] opacity-0 group-hover:opacity-100 transition">
                                    @{rel.user.username}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-[#949ba4] truncate">
                                {getStatusLabel(status)}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleOpenDM(rel.user.id)}
                              title="Mensagem"
                              className="w-9 h-9 rounded-full bg-[#2b2d31] hover:bg-[#111214] text-[#b5bac1] hover:text-white flex items-center justify-center transition cursor-pointer shadow-sm"
                            >
                              <MessageSquare className="w-4 h-4" />
                            </button>

                            <DropdownMenu.Root>
                              <DropdownMenu.Trigger asChild>
                                <button
                                  type="button"
                                  title="Mais opções"
                                  className="w-9 h-9 rounded-full bg-[#2b2d31] hover:bg-[#111214] text-[#b5bac1] hover:text-white flex items-center justify-center transition cursor-pointer shadow-sm"
                                >
                                  <MoreVertical className="w-4 h-4" />
                                </button>
                              </DropdownMenu.Trigger>
                              <DropdownMenu.Portal>
                                <DropdownMenu.Content
                                  side="bottom"
                                  align="end"
                                  className="w-44 bg-[#111214] border border-[#2b2d31] p-1.5 rounded-md shadow-xl text-xs font-medium z-50 text-[#dbdee1]"
                                >
                                  <DropdownMenu.Item
                                    onClick={() => removeRelationship(rel.user.id)}
                                    className="flex items-center justify-between px-2.5 py-1.5 rounded text-[#f23f43] hover:bg-[#f23f43] hover:text-white cursor-pointer transition-colors outline-none"
                                  >
                                    <span>Remover Amigo</span>
                                    <X className="w-3.5 h-3.5" />
                                  </DropdownMenu.Item>
                                  <DropdownMenu.Item
                                    onClick={() => blockUser(rel.user.id)}
                                    className="flex items-center justify-between px-2.5 py-1.5 rounded text-[#949ba4] hover:bg-[#f23f43] hover:text-white cursor-pointer transition-colors outline-none"
                                  >
                                    <span>Bloquear</span>
                                    <ShieldAlert className="w-3.5 h-3.5" />
                                  </DropdownMenu.Item>
                                </DropdownMenu.Content>
                              </DropdownMenu.Portal>
                            </DropdownMenu.Root>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB: ALL */}
            {activeTab === "all" && (
              <div>
                <div className="text-[12px] font-bold tracking-wider text-[#949ba4] uppercase pb-2">
                  TODOS OS AMIGOS — {filterList(friends).length}
                </div>
                {filterList(friends).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-[#949ba4]">
                    <ConcordLogo size={64} variant="mascot" eyeColor="#1FCE66" bodyColor="#FFFFFF" />
                    <p className="mt-4 text-sm font-medium text-[#dbdee1]">
                      Você ainda não tem amigos adicionados.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab("add_friend")}
                      className="mt-3 bg-[#23a55a] hover:bg-[#1f9250] text-white text-xs font-semibold px-4 py-2 rounded-md transition cursor-pointer"
                    >
                      Adicionar Amigo
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-[#35373c]/50">
                    {filterList(friends).map((rel) => {
                      const status = presences[rel.user.id] || "offline";
                      const displayName = rel.user.global_name || rel.user.username;
                      return (
                        <div
                          key={rel.id}
                          className="group flex items-center justify-between py-2.5 px-3 hover:bg-[#35373c]/40 rounded-lg transition"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="relative shrink-0">
                              <div className="w-10 h-10 rounded-full bg-[#5865F2] flex items-center justify-center text-white font-bold text-sm overflow-hidden">
                                {rel.user.avatar ? (
                                  <img
                                    src={rel.user.avatar}
                                    alt={displayName}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  displayName.slice(0, 2).toUpperCase()
                                )}
                              </div>
                              <span
                                className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-[2.5px] border-[#313338] ${getStatusColor(
                                  status
                                )}`}
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white flex items-center gap-1.5 truncate">
                                <span>{displayName}</span>
                                {rel.user.global_name && (
                                  <span className="text-xs font-normal text-[#949ba4] opacity-0 group-hover:opacity-100 transition">
                                    @{rel.user.username}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-[#949ba4] truncate">
                                {getStatusLabel(status)}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleOpenDM(rel.user.id)}
                              title="Mensagem"
                              className="w-9 h-9 rounded-full bg-[#2b2d31] hover:bg-[#111214] text-[#b5bac1] hover:text-white flex items-center justify-center transition cursor-pointer shadow-sm"
                            >
                              <MessageSquare className="w-4 h-4" />
                            </button>

                            <DropdownMenu.Root>
                              <DropdownMenu.Trigger asChild>
                                <button
                                  type="button"
                                  title="Mais opções"
                                  className="w-9 h-9 rounded-full bg-[#2b2d31] hover:bg-[#111214] text-[#b5bac1] hover:text-white flex items-center justify-center transition cursor-pointer shadow-sm"
                                >
                                  <MoreVertical className="w-4 h-4" />
                                </button>
                              </DropdownMenu.Trigger>
                              <DropdownMenu.Portal>
                                <DropdownMenu.Content
                                  side="bottom"
                                  align="end"
                                  className="w-44 bg-[#111214] border border-[#2b2d31] p-1.5 rounded-md shadow-xl text-xs font-medium z-50 text-[#dbdee1]"
                                >
                                  <DropdownMenu.Item
                                    onClick={() => removeRelationship(rel.user.id)}
                                    className="flex items-center justify-between px-2.5 py-1.5 rounded text-[#f23f43] hover:bg-[#f23f43] hover:text-white cursor-pointer transition-colors outline-none"
                                  >
                                    <span>Remover Amigo</span>
                                    <X className="w-3.5 h-3.5" />
                                  </DropdownMenu.Item>
                                  <DropdownMenu.Item
                                    onClick={() => blockUser(rel.user.id)}
                                    className="flex items-center justify-between px-2.5 py-1.5 rounded text-[#949ba4] hover:bg-[#f23f43] hover:text-white cursor-pointer transition-colors outline-none"
                                  >
                                    <span>Bloquear</span>
                                    <ShieldAlert className="w-3.5 h-3.5" />
                                  </DropdownMenu.Item>
                                </DropdownMenu.Content>
                              </DropdownMenu.Portal>
                            </DropdownMenu.Root>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB: PENDING */}
            {activeTab === "pending" && (
              <div className="space-y-6">
                {/* Incoming Requests */}
                {incomingRequests.length > 0 && (
                  <div>
                    <div className="text-[12px] font-bold tracking-wider text-[#949ba4] uppercase pb-2">
                      SOLICITAÇÕES RECEBIDAS — {incomingRequests.length}
                    </div>
                    <div className="divide-y divide-[#35373c]/50">
                      {incomingRequests.map((rel) => {
                        const displayName = rel.user.global_name || rel.user.username;
                        return (
                          <div
                            key={rel.id}
                            className="group flex items-center justify-between py-2.5 px-3 hover:bg-[#35373c]/40 rounded-lg transition"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 h-10 rounded-full bg-[#5865F2] flex items-center justify-center text-white font-bold text-sm shrink-0 overflow-hidden">
                                {rel.user.avatar ? (
                                  <img
                                    src={rel.user.avatar}
                                    alt={displayName}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  displayName.slice(0, 2).toUpperCase()
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-white flex items-center gap-1.5 truncate">
                                  <span>{displayName}</span>
                                  <span className="text-xs font-normal text-[#949ba4]">
                                    @{rel.user.username}
                                  </span>
                                </div>
                                <div className="text-xs text-[#23a55a]">
                                  Solicitação de amizade recebida
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => acceptRequest(rel.user.id)}
                                title="Aceitar"
                                className="w-9 h-9 rounded-full bg-[#2b2d31] hover:bg-[#23a55a] text-[#b5bac1] hover:text-white flex items-center justify-center transition cursor-pointer shadow-sm"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeRelationship(rel.user.id)}
                                title="Recusar"
                                className="w-9 h-9 rounded-full bg-[#2b2d31] hover:bg-[#f23f43] text-[#b5bac1] hover:text-white flex items-center justify-center transition cursor-pointer shadow-sm"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Outgoing Requests */}
                {outgoingRequests.length > 0 && (
                  <div>
                    <div className="text-[12px] font-bold tracking-wider text-[#949ba4] uppercase pb-2">
                      SOLICITAÇÕES ENVIADAS — {outgoingRequests.length}
                    </div>
                    <div className="divide-y divide-[#35373c]/50">
                      {outgoingRequests.map((rel) => {
                        const displayName = rel.user.global_name || rel.user.username;
                        return (
                          <div
                            key={rel.id}
                            className="group flex items-center justify-between py-2.5 px-3 hover:bg-[#35373c]/40 rounded-lg transition"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 h-10 rounded-full bg-[#5865F2] flex items-center justify-center text-white font-bold text-sm shrink-0 overflow-hidden">
                                {rel.user.avatar ? (
                                  <img
                                    src={rel.user.avatar}
                                    alt={displayName}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  displayName.slice(0, 2).toUpperCase()
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-white flex items-center gap-1.5 truncate">
                                  <span>{displayName}</span>
                                  <span className="text-xs font-normal text-[#949ba4]">
                                    @{rel.user.username}
                                  </span>
                                </div>
                                <div className="text-xs text-[#949ba4]">
                                  Solicitação de amizade enviada
                                </div>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => removeRelationship(rel.user.id)}
                              title="Cancelar solicitação"
                              className="w-9 h-9 rounded-full bg-[#2b2d31] hover:bg-[#f23f43] text-[#b5bac1] hover:text-white flex items-center justify-center transition cursor-pointer shadow-sm shrink-0"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {incomingRequests.length === 0 && outgoingRequests.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-[#949ba4]">
                    <ConcordLogo size={64} variant="mascot" eyeColor="#1FCE66" bodyColor="#FFFFFF" />
                    <p className="mt-4 text-sm font-medium text-[#dbdee1]">
                      Não há solicitações de amizade pendentes.
                    </p>
                    <p className="text-xs text-[#80848e] mt-1">
                      Você está em dia com todos os convites!
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* TAB: BLOCKED */}
            {activeTab === "blocked" && (
              <div>
                <div className="text-[12px] font-bold tracking-wider text-[#949ba4] uppercase pb-2">
                  BLOQUEADOS — {filterList(blockedUsers).length}
                </div>
                {filterList(blockedUsers).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-[#949ba4]">
                    <ConcordLogo size={64} variant="mascot" eyeColor="#1FCE66" bodyColor="#FFFFFF" />
                    <p className="mt-4 text-sm font-medium text-[#dbdee1]">
                      Você não tem nenhum usuário bloqueado.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#35373c]/50">
                    {filterList(blockedUsers).map((rel) => {
                      const displayName = rel.user.global_name || rel.user.username;
                      return (
                        <div
                          key={rel.id}
                          className="group flex items-center justify-between py-2.5 px-3 hover:bg-[#35373c]/40 rounded-lg transition"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-[#5865F2] flex items-center justify-center text-white font-bold text-sm shrink-0 overflow-hidden">
                              {rel.user.avatar ? (
                                <img
                                  src={rel.user.avatar}
                                  alt={displayName}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                displayName.slice(0, 2).toUpperCase()
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white truncate">
                                {displayName}
                              </div>
                              <div className="text-xs text-[#f23f43]">Bloqueado</div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => removeRelationship(rel.user.id)}
                            className="bg-[#2b2d31] hover:bg-[#f23f43] text-white text-xs font-semibold px-3 py-1.5 rounded-md transition cursor-pointer"
                          >
                            Desbloquear
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
