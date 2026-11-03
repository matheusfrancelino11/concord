import React, { useEffect, useState, useRef } from "react";
import { useAuthStore } from "./stores/authStore";
import { useGuildStore } from "./stores/guildStore";
import { useChannelStore } from "./stores/channelStore";
import { useMessageStore } from "./stores/messageStore";
import { usePresenceStore } from "./stores/presenceStore";
import { useVoiceStore } from "./stores/voiceStore";
import { useSettingsStore } from "./stores/settingsStore";
import { gateway } from "./gateway/GatewayClient";
import {
  GatewayEvent,
  Message,
  Presence,
  VoiceState,
  Member,
  GuildDetail,
  Role,
} from "./types";
import { LoginView } from "./components/auth/LoginView";
import { RegisterView } from "./components/auth/RegisterView";
import { AppLayout } from "./components/layout/AppLayout";
import { ConcordLoadingScreen } from "./components/common/ConcordLoadingScreen";
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

        // Desktop native notification
        const settings = useSettingsStore.getState();
        const isCurrent = msg.channel_id === currentChannelIdRef.current;
        const isChannelMuted = Boolean(settings.mutedChannels[msg.channel_id]);
        const isGuildMuted = Boolean(msg.guild_id && settings.mutedGuilds[msg.guild_id]);

        if (
          settings.notificationsEnabled &&
          !isChannelMuted &&
          !isGuildMuted &&
          (document.hidden || !isCurrent) &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          const author = msg.author?.global_name || msg.author?.username || "Concord";
          try {
            new Notification(author, {
              body: msg.content,
              silent: !settings.soundEnabled,
            });
          } catch {
            // Ignore notification error
          }
        }
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

    const unsubMemberUpdate = gateway.on<Member>(
      GatewayEvent.GUILD_MEMBER_UPDATE,
      (payload) => {
        useGuildStore.getState().handleMemberUpdate(payload);
      }
    );

    const unsubMemberRemove = gateway.on<{ guild_id: string; user_id: string }>(
      GatewayEvent.GUILD_MEMBER_REMOVE,
      (payload) => {
        if (payload.guild_id && payload.user_id) {
          useGuildStore.getState().handleMemberRemove(payload.guild_id, payload.user_id);
        }
      }
    );

    const unsubRoleCreate = gateway.on<{ guild_id: string; role: Role }>(
      GatewayEvent.GUILD_ROLE_CREATE,
      (payload) => {
        if (payload.guild_id && payload.role) {
          useGuildStore.getState().handleRoleCreate(payload.guild_id, payload.role);
        }
      }
    );

    const unsubRoleUpdate = gateway.on<{ guild_id: string; role: Role }>(
      GatewayEvent.GUILD_ROLE_UPDATE,
      (payload) => {
        if (payload.guild_id && payload.role) {
          useGuildStore.getState().handleRoleUpdate(payload.guild_id, payload.role);
        }
      }
    );

    const unsubRoleDelete = gateway.on<{ guild_id: string; role_id: string }>(
      GatewayEvent.GUILD_ROLE_DELETE,
      (payload) => {
        if (payload.guild_id && payload.role_id) {
          useGuildStore.getState().handleRoleDelete(payload.guild_id, payload.role_id);
        }
      }
    );

    const unsubGuildUpdate = gateway.on<Partial<GuildDetail> & { id: string }>(
      GatewayEvent.GUILD_UPDATE,
      (payload) => {
        if (payload.id) {
          useGuildStore.getState().handleGuildUpdate(payload);
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
      unsubMemberUpdate();
      unsubMemberRemove();
      unsubRoleCreate();
      unsubRoleUpdate();
      unsubRoleDelete();
      unsubGuildUpdate();
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

  // 4. Auto-select remembered guild or first guild
  useEffect(() => {
    if (isAuthenticated && guilds.length > 0 && !currentGuildId) {
      const lastGid = useSettingsStore.getState().lastGuildId;
      const targetGuild = (lastGid && guilds.find((g) => g.id === lastGid)) || guilds[0];
      selectGuild(targetGuild.id);
    }
  }, [isAuthenticated, guilds, currentGuildId, selectGuild]);

  // 5. Fetch channels when selected guild changes
  useEffect(() => {
    if (isAuthenticated && currentGuildId) {
      fetchChannels(currentGuildId);
    }
  }, [isAuthenticated, currentGuildId, fetchChannels]);

  // 6. Auto-select remembered channel or default #geral
  useEffect(() => {
    if (isAuthenticated && currentGuildId) {
      const guildChannels = channelsByGuild[currentGuildId] || channels || [];
      if (guildChannels.length > 0) {
        const hasValidSelected = guildChannels.some((c) => c.id === currentChannelId);
        if (!hasValidSelected) {
          const lastCid = useSettingsStore.getState().lastChannelId;
          const rememberedCh = lastCid && guildChannels.find((c) => c.id === lastCid);
          const defaultCh =
            rememberedCh ||
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

  // 7. Persist last selected guild and channel
  useEffect(() => {
    if (currentGuildId && currentChannelId) {
      useSettingsStore.getState().setLastLocation(currentGuildId, currentChannelId);
    }
  }, [currentGuildId, currentChannelId]);

  // 8. Theme synchronization (dark / light)
  const theme = useSettingsStore((s) => s.theme);
  useEffect(() => {
    if (theme === "light") {
      document.documentElement.classList.add("light");
      document.documentElement.classList.remove("dark");
    } else {
      document.documentElement.classList.add("dark");
      document.documentElement.classList.remove("light");
    }
  }, [theme]);

  // 9. Global Voice Shortcuts & Push-to-Talk Listener
  useEffect(() => {
    if (!isAuthenticated) return;

    let pttActive = false;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing inside input or textarea
      const targetTag = (e.target as HTMLElement)?.tagName;
      const isInputActive = targetTag === "INPUT" || targetTag === "TEXTAREA";

      // Shortcuts Ctrl+Shift+M (Mute) & Ctrl+Shift+D (Deafen)
      if (e.ctrlKey && e.shiftKey && (e.key === "M" || e.key === "m")) {
        e.preventDefault();
        useVoiceStore.getState().toggleMute();
        return;
      }
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        useVoiceStore.getState().toggleDeafen();
        return;
      }

      // Push-to-Talk logic
      if (!isInputActive) {
        const settings = useSettingsStore.getState();
        const voice = useVoiceStore.getState();
        if (
          settings.inputMode === "push_to_talk" &&
          voice.activeVoiceChannelId &&
          voice.currentRoom &&
          e.code === settings.pushToTalkKey &&
          !pttActive
        ) {
          pttActive = true;
          voice.currentRoom.localParticipant
            .setMicrophoneEnabled(true, {
              deviceId: settings.inputDeviceId !== "default" ? settings.inputDeviceId : undefined,
              echoCancellation: settings.echoCancellation,
              noiseSuppression: settings.noiseSuppression,
              autoGainControl: settings.autoGainControl,
            })
            .catch(console.warn);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const settings = useSettingsStore.getState();
      const voice = useVoiceStore.getState();
      if (
        settings.inputMode === "push_to_talk" &&
        voice.activeVoiceChannelId &&
        voice.currentRoom &&
        e.code === settings.pushToTalkKey &&
        pttActive
      ) {
        pttActive = false;
        voice.currentRoom.localParticipant.setMicrophoneEnabled(false).catch(console.warn);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isAuthenticated]);

  // Loading state on startup with animated Concord mascot
  if (authLoading) {
    return <ConcordLoadingScreen message="Conectando ao Concord..." />;
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
