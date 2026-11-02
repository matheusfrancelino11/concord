import React, { useEffect, useState, useRef } from "react";
import { useAuthStore } from "./stores/authStore";
import { useGuildStore } from "./stores/guildStore";
import { useChannelStore } from "./stores/channelStore";
import { useMessageStore } from "./stores/messageStore";
import { usePresenceStore } from "./stores/presenceStore";
import { useVoiceStore } from "./stores/voiceStore";
import { gateway } from "./gateway/GatewayClient";
import {
  GatewayEvent,
  Message,
  Presence,
  VoiceState,
  Member,
  GuildDetail,
} from "./types";
import { LoginView } from "./components/auth/LoginView";
import { RegisterView } from "./components/auth/RegisterView";
import { AppLayout } from "./components/layout/AppLayout";
import { Loader2 } from "lucide-react";

export const App: React.FC = () => {
  const { isAuthenticated, isLoading: authLoading, checkAuth } = useAuthStore();
  const { guilds, selectedGuildId, activeGuildId, fetchGuilds, selectGuild } = useGuildStore();
  const { channels, channelsByGuild, selectedChannelId, activeChannelId, fetchChannels, selectChannel } = useChannelStore();
  const handleMessageCreate = useMessageStore((s) => s.handleMessageCreate);
  const handleMessageUpdate = useMessageStore((s) => s.handleMessageUpdate);
  const handleMessageDelete = useMessageStore((s) => s.handleMessageDelete);
  const handleTypingStart = useMessageStore((s) => s.handleTypingStart);
  const cleanupExpiredTyping = useMessageStore((s) => s.cleanupExpiredTyping);
  const resetMessageStore = useMessageStore((s) => s.reset);

  const currentGuildId = selectedGuildId || activeGuildId;
  const currentChannelId = selectedChannelId || activeChannelId;
  const currentChannelIdRef = useRef(currentChannelId);

  useEffect(() => {
    currentChannelIdRef.current = currentChannelId;
  }, [currentChannelId]);

  const [authView, setAuthView] = useState<"login" | "register">("login");

  // 1. Initial boot check
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // 2. Gateway Connection & Event Dispatchers
  useEffect(() => {
    if (!isAuthenticated) {
      gateway.disconnect();
      resetMessageStore();
      return;
    }

    // Connect to WebSocket gateway
    gateway.connect();

    // Event Listeners
    const unsubMessageCreate = gateway.on<Message>(
      GatewayEvent.MESSAGE_CREATE,
      (msg) => {
        handleMessageCreate(msg, currentChannelIdRef.current);
      }
    );

    const unsubMessageUpdate = gateway.on<Message>(
      GatewayEvent.MESSAGE_UPDATE,
      (msg) => {
        handleMessageUpdate(msg);
      }
    );

    const unsubMessageDelete = gateway.on<{ id: string; channel_id: string; guild_id?: string }>(
      GatewayEvent.MESSAGE_DELETE,
      (payload) => {
        handleMessageDelete(payload);
      }
    );

    const unsubTypingStart = gateway.on<{
      channel_id: string;
      guild_id?: string;
      user_id: string;
      username?: string;
      timestamp?: number;
    }>(GatewayEvent.TYPING_START, (payload) => {
      handleTypingStart(payload);
    });

    // Milestone 3 Gateway Listeners
    const unsubPresenceUpdate = gateway.on<Presence>(
      GatewayEvent.PRESENCE_UPDATE,
      (payload) => {
        if (payload.user_id && payload.status) {
          usePresenceStore.getState().setPresence(payload.user_id, payload.status);
        }
      }
    );

    const unsubVoiceStateUpdate = gateway.on<VoiceState>(
      GatewayEvent.VOICE_STATE_UPDATE,
      (payload) => {
        useVoiceStore.getState().handleVoiceStateUpdate(payload);
      }
    );

    const unsubMemberAdd = gateway.on<Member>(
      GatewayEvent.GUILD_MEMBER_ADD,
      (payload) => {
        if (payload.guild_id) {
          useGuildStore.getState().addMember(payload.guild_id, payload);
        }
      }
    );

    const unsubGuildCreate = gateway.on<GuildDetail>(
      GatewayEvent.GUILD_CREATE,
      (guild) => {
        useGuildStore.getState().addGuildFromGateway(guild);
        if (guild.members && guild.members.length > 0) {
          useGuildStore.getState().setMembers(guild.id, guild.members);
        }
        if (guild.presences && guild.presences.length > 0) {
          usePresenceStore.getState().setBulkPresences(guild.presences);
        }
        if (guild.voice_states && guild.voice_states.length > 0) {
          useVoiceStore.getState().setGuildVoiceStates(guild.id, guild.voice_states);
        }
      }
    );

    // Sweeper for expired typing states (every 1s)
    const typingTimer = setInterval(() => {
      cleanupExpiredTyping();
    }, 1000);

    return () => {
      unsubMessageCreate();
      unsubMessageUpdate();
      unsubMessageDelete();
      unsubTypingStart();
      unsubPresenceUpdate();
      unsubVoiceStateUpdate();
      unsubMemberAdd();
      unsubGuildCreate();
      clearInterval(typingTimer);
      gateway.disconnect();
    };
  }, [
    isAuthenticated,
    handleMessageCreate,
    handleMessageUpdate,
    handleMessageDelete,
    handleTypingStart,
    cleanupExpiredTyping,
    resetMessageStore,
  ]);

  // 3. On authenticated, fetch guilds
  useEffect(() => {
    if (isAuthenticated) {
      fetchGuilds();
    }
  }, [isAuthenticated, fetchGuilds]);

  // 4. Auto-select first guild if none selected
  useEffect(() => {
    if (isAuthenticated && guilds.length > 0 && !currentGuildId) {
      selectGuild(guilds[0].id);
    }
  }, [isAuthenticated, guilds, currentGuildId, selectGuild]);

  // 5. Fetch channels when selected guild changes
  useEffect(() => {
    if (isAuthenticated && currentGuildId) {
      fetchChannels(currentGuildId);
    }
  }, [isAuthenticated, currentGuildId, fetchChannels]);

  // 6. Auto-select default #geral or first text channel
  useEffect(() => {
    if (isAuthenticated && currentGuildId) {
      const guildChannels = channelsByGuild[currentGuildId] || channels || [];
      if (guildChannels.length > 0) {
        const hasValidSelected = guildChannels.some((c) => c.id === currentChannelId);
        if (!hasValidSelected) {
          const defaultCh =
            guildChannels.find((c) => c.name === "geral" && c.type === 0) ||
            guildChannels.find((c) => c.type === 0) ||
            guildChannels[0];
          if (defaultCh) {
            selectChannel(defaultCh.id);
          }
        }
      }
    }
  }, [isAuthenticated, currentGuildId, channelsByGuild, channels, currentChannelId, selectChannel]);

  // Loading state on startup
  if (authLoading) {
    return (
      <div className="h-screen w-screen bg-[#1e1f22] flex flex-col items-center justify-center gap-4 text-white select-none">
        <Loader2 className="w-10 h-10 animate-spin text-[#5865F2]" />
        <p className="text-sm font-medium text-[#949ba4]">Connecting to Concord...</p>
      </div>
    );
  }

  // Unauthenticated: render Login or Register
  if (!isAuthenticated) {
    return authView === "login" ? (
      <LoginView onNavigateToRegister={() => setAuthView("register")} />
    ) : (
      <RegisterView onNavigateToLogin={() => setAuthView("login")} />
    );
  }

  // Authenticated: render 3-sidebar layout
  return <AppLayout />;
};

export default App;
