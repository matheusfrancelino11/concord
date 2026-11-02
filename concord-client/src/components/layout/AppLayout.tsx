import React, { useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChannelList } from "./ChannelList";
import { MainContent } from "./MainContent";
import { CreateServerModal } from "../modals/CreateServerModal";
import { CreateChannelModal } from "../modals/CreateChannelModal";

export const AppLayout: React.FC = () => {
  const [isCreateServerOpen, setIsCreateServerOpen] = useState(false);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
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
      />

      {/* 3. Main Content Area (flex-1) */}
      <MainContent onOpenCreateServer={() => setIsCreateServerOpen(true)} />

      {/* Modals */}
      <CreateServerModal
        open={isCreateServerOpen}
        onOpenChange={setIsCreateServerOpen}
      />
      <CreateChannelModal
        open={isCreateChannelOpen}
        onOpenChange={setIsCreateChannelOpen}
        initialType={channelModalType}
      />
    </div>
  );
};
