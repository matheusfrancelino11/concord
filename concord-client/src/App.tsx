import React, { useEffect, useState } from "react";
import { useAuthStore } from "./stores/authStore";
import { useGuildStore } from "./stores/guildStore";
import { useChannelStore } from "./stores/channelStore";
import { LoginView } from "./components/auth/LoginView";
import { RegisterView } from "./components/auth/RegisterView";
import { AppLayout } from "./components/layout/AppLayout";
import { Loader2 } from "lucide-react";

export const App: React.FC = () => {
  const { isAuthenticated, isLoading: authLoading, checkAuth } = useAuthStore();
  const { guilds, selectedGuildId, activeGuildId, fetchGuilds, selectGuild } = useGuildStore();
  const { channels, channelsByGuild, selectedChannelId, activeChannelId, fetchChannels, selectChannel } = useChannelStore();

  const currentGuildId = selectedGuildId || activeGuildId;
  const currentChannelId = selectedChannelId || activeChannelId;

  const [authView, setAuthView] = useState<"login" | "register">("login");

  // 1. Initial boot check
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // 2. On authenticated, fetch guilds
  useEffect(() => {
    if (isAuthenticated) {
      fetchGuilds();
    }
  }, [isAuthenticated, fetchGuilds]);

  // 3. Auto-select first guild if none selected
  useEffect(() => {
    if (isAuthenticated && guilds.length > 0 && !currentGuildId) {
      selectGuild(guilds[0].id);
    }
  }, [isAuthenticated, guilds, currentGuildId, selectGuild]);

  // 4. Fetch channels when selected guild changes
  useEffect(() => {
    if (isAuthenticated && currentGuildId) {
      fetchChannels(currentGuildId);
    }
  }, [isAuthenticated, currentGuildId, fetchChannels]);

  // 5. Auto-select default #geral or first text channel
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
