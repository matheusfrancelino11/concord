import React, { useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChannelList } from "./ChannelList";
import { MainContent } from "./MainContent";
import { CreateServerModal } from "../modals/CreateServerModal";
import { CreateChannelModal } from "../modals/CreateChannelModal";
import { InviteModal } from "../modals/InviteModal";
import { JoinServerModal } from "../modals/JoinServerModal";
import { ServerSettingsModal } from "../modals/ServerSettingsModal";
import { useGuildStore } from "../../stores/guildStore";

export const AppLayout: React.FC = () => {
  const { selectedGuildId, activeGuildId } = useGuildStore();
  const currentGuildId = selectedGuildId || activeGuildId;

  const [isCreateServerOpen, setIsCreateServerOpen] = useState(false);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isJoinServerOpen, setIsJoinServerOpen] = useState(false);
  const [isServerSettingsOpen, setIsServerSettingsOpen] = useState(false);
  const [showMemberList, setShowMemberList] = useState(true);
  const [channelModalType, setChannelModalType] = useState<0 | 2>(0);

  const handleOpenCreateChannel = (type: 0 | 2 = 0) => {
    setChannelModalType(type);
    setIsCreateChannelOpen(true);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#313338] text-white select-none">
      {/* 1. Server Sidebar (72px) */}
      <Sidebar onOpenCreateServer={() => setIsCreateServerOpen(true)} />

      {/* 2. Channel Sidebar (240px) */}
      <ChannelList
        onOpenCreateChannel={handleOpenCreateChannel}
        onOpenCreateServer={() => setIsCreateServerOpen(true)}
        onOpenInvite={() => setIsInviteOpen(true)}
        onOpenServerSettings={() => setIsServerSettingsOpen(true)}
      />

      {/* 3. Main Content Area + MemberList */}
      <MainContent
        onOpenCreateServer={() => setIsCreateServerOpen(true)}
        showMemberList={showMemberList}
        onToggleMemberList={() => setShowMemberList(!showMemberList)}
      />

      {/* Modals */}
      <CreateServerModal
        open={isCreateServerOpen}
        onOpenChange={setIsCreateServerOpen}
        onOpenJoinServer={() => setIsJoinServerOpen(true)}
      />
      <CreateChannelModal
        open={isCreateChannelOpen}
        onOpenChange={setIsCreateChannelOpen}
        initialType={channelModalType}
      />
      {currentGuildId && (
        <>
          <InviteModal
            open={isInviteOpen}
            onOpenChange={setIsInviteOpen}
            guildId={currentGuildId}
          />
          <ServerSettingsModal
            open={isServerSettingsOpen}
            onOpenChange={setIsServerSettingsOpen}
            guildId={currentGuildId}
          />
        </>
      )}
      <JoinServerModal
        open={isJoinServerOpen}
        onOpenChange={setIsJoinServerOpen}
      />
    </div>
  );
};
