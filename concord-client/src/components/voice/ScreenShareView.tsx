import React, { useEffect, useRef, useState } from "react";
import { ActiveScreenShare, useVoiceStore } from "../../stores/voiceStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { Maximize2, Minimize2, MonitorOff, Tv, Radio, Volume2, VolumeX } from "lucide-react";

interface ScreenShareViewProps {
  screenShare: ActiveScreenShare;
  channelName?: string;
  onMinimize?: () => void;
}

export const ScreenShareView: React.FC<ScreenShareViewProps> = ({
  screenShare,
  channelName,
  onMinimize,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const toggleScreenShare = useVoiceStore((s) => s.toggleScreenShare);
  const screenShareVolume = useSettingsStore((s) => s.screenShareVolume);
  const setScreenShareVolume = useSettingsStore((s) => s.setScreenShareVolume);

  const handleVolumeChange = (val: number) => {
    setScreenShareVolume(val);
    document.querySelectorAll("audio[data-screen-audio='true']").forEach((el) => {
      (el as HTMLAudioElement).volume = Math.max(0, Math.min(1, val / 100));
    });
  };

  // Attach and detach the LiveKit video track
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !screenShare.videoTrack) return;

    screenShare.videoTrack.attach(videoEl);

    return () => {
      screenShare.videoTrack.detach(videoEl);
    };
  }, [screenShare.videoTrack]);

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const handleToggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn("[ScreenShareView] Fullscreen toggle error:", err);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative flex-1 w-full h-full bg-[#000000] rounded-lg overflow-hidden flex items-center justify-center group select-none shadow-2xl"
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={screenShare.isLocal} // Avoid local echo
        className="w-full h-full object-contain"
      />

      {/* Top Header Overlay */}
      <div className="absolute top-0 left-0 right-0 p-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between opacity-90 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#f23f43] text-white text-[11px] font-bold tracking-wider uppercase">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <span>LIVE</span>
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-white drop-shadow leading-tight">
              {screenShare.isLocal ? "Your Screen" : `${screenShare.userName}'s Stream`}
            </span>
            {channelName && (
              <span className="text-[11px] text-[#dbdee1]/80 leading-tight">
                #{channelName}
              </span>
            )}
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex items-center gap-1.5">
          {screenShare.isLocal && (
            <button
              type="button"
              onClick={toggleScreenShare}
              title="Stop Sharing Screen"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#f23f43] hover:bg-[#da373b] text-white text-xs font-semibold transition cursor-pointer shadow-md mr-1"
            >
              <MonitorOff className="w-3.5 h-3.5" />
              <span>Stop Sharing</span>
            </button>
          )}

          {/* Volume Control for Remote Streams */}
          {!screenShare.isLocal && (
            <div className="relative flex items-center">
              <button
                type="button"
                onClick={() => setShowVolume(!showVolume)}
                title={`Volume da Live (${screenShareVolume}%)`}
                className="p-2 rounded bg-black/50 hover:bg-black/75 text-white/90 hover:text-white transition cursor-pointer backdrop-blur-sm"
              >
                {screenShareVolume === 0 ? (
                  <VolumeX className="w-4 h-4 text-[#f23f43]" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>

              {showVolume && (
                <div className="absolute top-10 right-0 bg-[#111214] border border-[#2b2d31] p-3 rounded-lg shadow-xl flex items-center gap-2 z-20 w-44">
                  <input
                    type="range"
                    min="0"
                    max="200"
                    value={screenShareVolume}
                    onChange={(e) => handleVolumeChange(Number(e.target.value))}
                    className="w-full accent-[#5865F2] cursor-pointer"
                  />
                  <span className="text-xs font-bold text-white shrink-0 w-8 text-right">
                    {screenShareVolume}%
                  </span>
                </div>
              )}
            </div>
          )}

          {onMinimize && (
            <button
              type="button"
              onClick={onMinimize}
              title="Back to Grid View"
              className="p-2 rounded bg-black/50 hover:bg-black/75 text-white/90 hover:text-white transition cursor-pointer backdrop-blur-sm"
            >
              <Tv className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={handleToggleFullscreen}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            className="p-2 rounded bg-black/50 hover:bg-black/75 text-white/90 hover:text-white transition cursor-pointer backdrop-blur-sm"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Subtle Bottom Badge Overlay */}
      <div className="absolute bottom-2 left-3 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-black/60 text-[#dbdee1] text-[10px] font-medium backdrop-blur-sm">
          <Radio className="w-3 h-3 text-[#23a55a]" />
          <span>LiveKit WebRTC Stream (720p/1080p 30fps)</span>
        </div>
      </div>
    </div>
  );
};
