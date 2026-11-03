import React, { useState, useEffect, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useSettingsStore, InputMode, ScreenResolution, ScreenFps, ThemeMode } from "../../stores/settingsStore";
import { useVoiceStore } from "../../stores/voiceStore";
import { useAuthStore } from "../../stores/authStore";
import {
  X,
  Mic,
  Volume2,
  Tv,
  Bell,
  Palette,
  RotateCcw,
  Keyboard,
  Check,
  Play,
  Square,
  AlertTriangle,
} from "lucide-react";

interface UserSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type TabType = "voice" | "screenshare" | "appearance" | "notifications";

export const UserSettingsModal: React.FC<UserSettingsModalProps> = ({ open, onOpenChange }) => {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabType>("voice");

  // Settings store
  const {
    inputDeviceId,
    inputVolume,
    inputMode,
    pushToTalkKey,
    pushToTalkKeyLabel,
    sensitivity,
    autoSensitivity,
    noiseSuppression,
    echoCancellation,
    autoGainControl,
    outputDeviceId,
    outputVolume,
    attenuationEnabled,
    attenuationPercentage,
    screenShareResolution,
    screenShareFps,
    screenShareVolume,
    theme,
    notificationsEnabled,
    soundEnabled,
    minimizeToTray,
    startWithWindows,
    setInputDeviceId,
    setInputVolume,
    setInputMode,
    setPushToTalkKey,
    setSensitivity,
    setAutoSensitivity,
    setNoiseSuppression,
    setEchoCancellation,
    setAutoGainControl,
    setOutputDeviceId,
    setOutputVolume,
    setAttenuationEnabled,
    setAttenuationPercentage,
    resetVoiceSettings,
    setScreenShareResolution,
    setScreenShareFps,
    setScreenShareVolume,
    setTheme,
    setNotificationsEnabled,
    setSoundEnabled,
    setMinimizeToTray,
    setStartWithWindows,
  } = useSettingsStore();

  const { switchInputDevice, switchOutputDevice } = useVoiceStore();

  // Audio devices list
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);

  // Mic test state
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [micLevel, setMicLevel] = useState(0); // 0 to 100
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Key recording state for PTT
  const [isRecordingKey, setIsRecordingKey] = useState(false);

  // Load available audio devices
  const refreshDevices = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter((d) => d.kind === "audioinput");
        const outputs = devices.filter((d) => d.kind === "audiooutput");
        setAudioInputDevices(inputs);
        setAudioOutputDevices(outputs);
      }
    } catch (err) {
      console.warn("[UserSettings] Could not enumerate devices:", err);
    }
  };

  useEffect(() => {
    if (open) {
      refreshDevices();
    } else {
      stopMicTest();
      setIsRecordingKey(false);
    }
  }, [open]);

  // Listen for device changes
  useEffect(() => {
    const handleDeviceChange = () => {
      refreshDevices();
    };
    if (navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
      return () => {
        navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
      };
    }
  }, []);

  // Handle microphone testing
  const startMicTest = async () => {
    try {
      const constraints: MediaStreamConstraints = {
        audio: inputDeviceId && inputDeviceId !== "default"
          ? { deviceId: { exact: inputDeviceId }, echoCancellation, noiseSuppression, autoGainControl }
          : { echoCancellation, noiseSuppression, autoGainControl },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      micStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateMeter = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        // Normalize 0 - 255 to percentage 0 - 100 with scaling
        const normalized = Math.min(100, Math.round((average / 128) * 100));
        setMicLevel(normalized);
        animFrameRef.current = requestAnimationFrame(updateMeter);
      };

      setIsTestingMic(true);
      updateMeter();
    } catch (err) {
      console.error("[UserSettings] Error starting mic test:", err);
      alert("Não foi possível acessar o microfone para teste.");
    }
  };

  const stopMicTest = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setIsTestingMic(false);
    setMicLevel(0);
  };

  const toggleMicTest = () => {
    if (isTestingMic) {
      stopMicTest();
    } else {
      startMicTest();
    }
  };

  // Test sound output
  const handleTestSound = () => {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(440, ctx.currentTime); // Concert A
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);

      gain.gain.setValueAtTime((outputVolume / 200) * 0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.35);
      setTimeout(() => ctx.close(), 400);
    } catch (err) {
      console.warn("[UserSettings] Could not play test sound:", err);
    }
  };

  // Listen for key recording when setting Push-to-Talk
  useEffect(() => {
    if (!isRecordingKey) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const code = e.code;
      let label = e.key.toUpperCase();
      if (code === "ControlLeft" || code === "ControlRight") label = "Ctrl";
      if (code === "ShiftLeft" || code === "ShiftRight") label = "Shift";
      if (code === "AltLeft" || code === "AltRight") label = "Alt";
      if (code === "Space") label = "Space";

      setPushToTalkKey(code, label);
      setIsRecordingKey(false);
    };

    window.addEventListener("keydown", handleKeyDown, { once: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isRecordingKey, setPushToTalkKey]);

  // Request browser notification permission
  const handleRequestNotificationPermission = async () => {
    if ("Notification" in window) {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        setNotificationsEnabled(true);
        new Notification("Concord", {
          body: "Notificações na área de trabalho ativadas com sucesso!",
        });
      } else {
        setNotificationsEnabled(false);
      }
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 animate-in fade-in-0" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] max-w-[95vw] h-[640px] max-h-[92vh] bg-[#313338] text-[#dbdee1] rounded-lg shadow-2xl flex overflow-hidden z-50 border border-[#232428] outline-none">
          {/* Left Navigation Sidebar */}
          <div className="w-60 min-w-[240px] bg-[#2b2d31] p-6 flex flex-col justify-between border-r border-[#1f2023]/60 select-none">
            <div className="space-y-6">
              <div>
                <h3 className="px-2 text-[11px] font-bold tracking-wider text-[#949ba4] uppercase mb-1.5">
                  Configurações do Usuário
                </h3>
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab("voice")}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition cursor-pointer ${
                      activeTab === "voice"
                        ? "bg-[#404249] text-white"
                        : "text-[#949ba4] hover:bg-[#35373c]/60 hover:text-[#dbdee1]"
                    }`}
                  >
                    <Mic className="w-4 h-4" />
                    <span>Voz e Vídeo</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab("screenshare")}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition cursor-pointer ${
                      activeTab === "screenshare"
                        ? "bg-[#404249] text-white"
                        : "text-[#949ba4] hover:bg-[#35373c]/60 hover:text-[#dbdee1]"
                    }`}
                  >
                    <Tv className="w-4 h-4" />
                    <span>Transmissão</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab("appearance")}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition cursor-pointer ${
                      activeTab === "appearance"
                        ? "bg-[#404249] text-white"
                        : "text-[#949ba4] hover:bg-[#35373c]/60 hover:text-[#dbdee1]"
                    }`}
                  >
                    <Palette className="w-4 h-4" />
                    <span>Aparência</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab("notifications")}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition cursor-pointer ${
                      activeTab === "notifications"
                        ? "bg-[#404249] text-white"
                        : "text-[#949ba4] hover:bg-[#35373c]/60 hover:text-[#dbdee1]"
                    }`}
                  >
                    <Bell className="w-4 h-4" />
                    <span>Notificações & Desktop</span>
                  </button>
                </div>
              </div>
            </div>

            {/* User Profile Mini Footer */}
            <div className="pt-4 border-t border-[#1f2023]/60 flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[#5865F2] flex items-center justify-center font-bold text-white text-xs shrink-0">
                {user?.avatar ? (
                  <img src={user.avatar} alt={user.username} className="w-full h-full rounded-full object-cover" />
                ) : (
                  (user?.global_name || user?.username || "?").charAt(0).toUpperCase()
                )}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-white truncate">
                  {user?.global_name || user?.username}
                </span>
                <span className="text-[10px] text-[#949ba4] truncate">
                  @{user?.username}
                </span>
              </div>
            </div>
          </div>

          {/* Right Main Content Pane */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
            {/* Close Button top-right */}
            <div className="absolute top-4 right-5 z-10 flex items-center gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="w-8 h-8 rounded-full border border-[#4e5058] flex items-center justify-center text-[#949ba4] hover:text-white hover:border-white transition cursor-pointer"
                title="Fechar (ESC)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tab Contents with Scroll */}
            <div className="flex-1 overflow-y-auto p-8 pr-12 space-y-8 select-text">
              {/* ========================================================
                  TAB 1: VOZ E VÍDEO
                  ======================================================== */}
              {activeTab === "voice" && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-xl font-bold text-white mb-1">Configurações de Voz</h2>
                    <p className="text-xs text-[#949ba4]">
                      Ajuste seus dispositivos de entrada, saída, volumes e sensibilidade do microfone.
                    </p>
                  </div>

                  {/* Device Selectors Row */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Input Device */}
                    <div>
                      <label className="block text-xs font-bold text-[#b5bac1] uppercase tracking-wider mb-2">
                        Dispositivo de Entrada (Microfone)
                      </label>
                      <select
                        value={inputDeviceId}
                        onChange={(e) => {
                          const val = e.target.value;
                          setInputDeviceId(val);
                          switchInputDevice(val);
                        }}
                        className="w-full bg-[#1e1f22] border border-[#1f2023] rounded p-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#5865F2] cursor-pointer"
                      >
                        <option value="default">Padrão do Sistema</option>
                        {audioInputDevices.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label || `Microfone ${d.deviceId.slice(0, 6)}`}
                          </option>
                        ))}
                      </select>

                      {/* Input Volume Slider */}
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-[#949ba4] mb-1">
                          <span>Volume de Entrada</span>
                          <span className="font-semibold text-white">{inputVolume}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={inputVolume}
                          onChange={(e) => setInputVolume(Number(e.target.value))}
                          className="w-full accent-[#5865F2] cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* Output Device */}
                    <div>
                      <label className="block text-xs font-bold text-[#b5bac1] uppercase tracking-wider mb-2">
                        Dispositivo de Saída (Alto-falante / Fone)
                      </label>
                      <select
                        value={outputDeviceId}
                        onChange={(e) => {
                          const val = e.target.value;
                          setOutputDeviceId(val);
                          switchOutputDevice(val);
                        }}
                        className="w-full bg-[#1e1f22] border border-[#1f2023] rounded p-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#5865F2] cursor-pointer"
                      >
                        <option value="default">Padrão do Sistema</option>
                        {audioOutputDevices.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {d.label || `Alto-falante ${d.deviceId.slice(0, 6)}`}
                          </option>
                        ))}
                      </select>

                      {/* Output Volume Slider */}
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-[#949ba4] mb-1">
                          <span>Volume de Saída Geral</span>
                          <span className="font-semibold text-white">{outputVolume}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="200"
                          value={outputVolume}
                          onChange={(e) => setOutputVolume(Number(e.target.value))}
                          className="w-full accent-[#5865F2] cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Mic Test Section */}
                  <div className="p-4 rounded-lg bg-[#2b2d31] border border-[#1f2023]/60 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold text-white">Teste de Microfone</div>
                        <div className="text-xs text-[#949ba4]">
                          Está ouvindo um ruído esquisito? Fale no microfone e confira o medidor de volume.
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleTestSound}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#35373c] hover:bg-[#404249] text-white text-xs font-medium transition cursor-pointer"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                          <span>Testar Som</span>
                        </button>
                        <button
                          type="button"
                          onClick={toggleMicTest}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition cursor-pointer shadow-sm ${
                            isTestingMic
                              ? "bg-[#f23f43] hover:bg-[#da373b] text-white"
                              : "bg-[#5865F2] hover:bg-[#4752c4] text-white"
                          }`}
                        >
                          {isTestingMic ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                          <span>{isTestingMic ? "Parar Teste" : "Vamos Testar"}</span>
                        </button>
                      </div>
                    </div>

                    {/* Live VU Meter Bar */}
                    <div className="h-3 w-full bg-[#1e1f22] rounded-full overflow-hidden p-0.5 border border-[#1f2023]">
                      <div
                        className="h-full bg-gradient-to-r from-[#23a55a] via-[#f0b232] to-[#f23f43] rounded-full transition-all duration-75"
                        style={{ width: `${isTestingMic ? micLevel : 0}%` }}
                      />
                    </div>
                  </div>

                  {/* Input Mode (VAD vs Push-to-Talk) */}
                  <div className="space-y-3">
                    <label className="block text-xs font-bold text-[#b5bac1] uppercase tracking-wider">
                      Modo de Entrada
                    </label>
                    <div className="grid grid-cols-2 gap-4">
                      {/* Voice Activity Radio */}
                      <label
                        className={`flex items-center gap-3 p-3.5 rounded-lg border cursor-pointer transition ${
                          inputMode === "voice_activity"
                            ? "border-[#5865F2] bg-[#5865F2]/10 text-white"
                            : "border-[#1f2023] bg-[#2b2d31] text-[#949ba4] hover:bg-[#35373c]"
                        }`}
                      >
                        <input
                          type="radio"
                          name="inputMode"
                          checked={inputMode === "voice_activity"}
                          onChange={() => setInputMode("voice_activity")}
                          className="accent-[#5865F2] w-4 h-4 cursor-pointer"
                        />
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold">Detecção de Voz</span>
                          <span className="text-xs text-[#949ba4]">O microfone transmite automaticamente quando você fala.</span>
                        </div>
                      </label>

                      {/* Push-to-Talk Radio */}
                      <label
                        className={`flex items-center gap-3 p-3.5 rounded-lg border cursor-pointer transition ${
                          inputMode === "push_to_talk"
                            ? "border-[#5865F2] bg-[#5865F2]/10 text-white"
                            : "border-[#1f2023] bg-[#2b2d31] text-[#949ba4] hover:bg-[#35373c]"
                        }`}
                      >
                        <input
                          type="radio"
                          name="inputMode"
                          checked={inputMode === "push_to_talk"}
                          onChange={() => setInputMode("push_to_talk")}
                          className="accent-[#5865F2] w-4 h-4 cursor-pointer"
                        />
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold">Push-to-Talk</span>
                          <span className="text-xs text-[#949ba4]">O microfone só abre enquanto a tecla configurada é segurada.</span>
                        </div>
                      </label>
                    </div>

                    {/* Push-to-Talk Key Configuration */}
                    {inputMode === "push_to_talk" && (
                      <div className="p-3.5 rounded-lg bg-[#2b2d31] border border-[#1f2023]/60 flex items-center justify-between animate-in fade-in-50">
                        <div className="flex items-center gap-3">
                          <Keyboard className="w-5 h-5 text-[#5865F2]" />
                          <div>
                            <div className="text-sm font-semibold text-white">Atalho de Push-to-Talk</div>
                            <div className="text-xs text-[#949ba4]">
                              Tecla atual: <span className="font-bold text-white bg-[#1e1f22] px-2 py-0.5 rounded border border-[#1f2023]">{pushToTalkKeyLabel}</span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setIsRecordingKey(true)}
                          className={`px-3 py-1.5 rounded text-xs font-semibold transition cursor-pointer ${
                            isRecordingKey
                              ? "bg-[#f23f43] text-white animate-pulse"
                              : "bg-[#5865F2] hover:bg-[#4752c4] text-white shadow"
                          }`}
                        >
                          {isRecordingKey ? "Pressione qualquer tecla..." : "Gravar Tecla"}
                        </button>
                      </div>
                    )}

                    {/* Voice Activity Sensitivity */}
                    {inputMode === "voice_activity" && (
                      <div className="p-3.5 rounded-lg bg-[#2b2d31] border border-[#1f2023]/60 space-y-2 animate-in fade-in-50">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">Sensibilidade de Entrada</span>
                          <label className="flex items-center gap-2 text-xs text-[#949ba4] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={autoSensitivity}
                              onChange={(e) => setAutoSensitivity(e.target.checked)}
                              className="accent-[#5865F2] rounded cursor-pointer"
                            />
                            <span>Automática</span>
                          </label>
                        </div>

                        {!autoSensitivity && (
                          <div className="space-y-1 pt-1">
                            <div className="flex justify-between text-[11px] text-[#949ba4]">
                              <span>Manual: {sensitivity} dB</span>
                              <span>(Mais sensível ◄ ► Menos sensível)</span>
                            </div>
                            <input
                              type="range"
                              min="-100"
                              max="0"
                              value={sensitivity}
                              onChange={(e) => setSensitivity(Number(e.target.value))}
                              className="w-full accent-[#5865F2] cursor-pointer"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Advanced Voice Processing Options */}
                  <div className="space-y-3 pt-2">
                    <label className="block text-xs font-bold text-[#b5bac1] uppercase tracking-wider">
                      Processamento Avançado de Voz
                    </label>
                    <div className="space-y-2 bg-[#2b2d31] p-3.5 rounded-lg border border-[#1f2023]/60">
                      <label className="flex items-center justify-between text-xs cursor-pointer hover:text-white py-1">
                        <div>
                          <div className="font-semibold text-white">Cancelamento de Eco</div>
                          <div className="text-[11px] text-[#949ba4]">Evita que o som do seu fone/alto-falante volte pelo microfone.</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={echoCancellation}
                          onChange={(e) => setEchoCancellation(e.target.checked)}
                          className="accent-[#5865F2] w-4 h-4 rounded cursor-pointer"
                        />
                      </label>

                      <div className="h-[1px] bg-[#1f2023]" />

                      <label className="flex items-center justify-between text-xs cursor-pointer hover:text-white py-1">
                        <div>
                          <div className="font-semibold text-white">Supressão de Ruído</div>
                          <div className="text-[11px] text-[#949ba4]">Filtra ruídos de fundo como ventiladores, teclados e barulhos externos.</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={noiseSuppression}
                          onChange={(e) => setNoiseSuppression(e.target.checked)}
                          className="accent-[#5865F2] w-4 h-4 rounded cursor-pointer"
                        />
                      </label>

                      <div className="h-[1px] bg-[#1f2023]" />

                      <label className="flex items-center justify-between text-xs cursor-pointer hover:text-white py-1">
                        <div>
                          <div className="font-semibold text-white">Controle Automático de Ganho</div>
                          <div className="text-[11px] text-[#949ba4]">Equaliza o volume da sua fala automaticamente para manter nível constante.</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={autoGainControl}
                          onChange={(e) => setAutoGainControl(e.target.checked)}
                          className="accent-[#5865F2] w-4 h-4 rounded cursor-pointer"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Reset voice settings button */}
                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm("Deseja redefinir todas as configurações de voz para os valores padrão?")) {
                          resetVoiceSettings();
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-[#f23f43] hover:bg-[#f23f43]/10 transition cursor-pointer font-medium"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Redefinir configurações de voz</span>
                    </button>
                  </div>
                </div>
              )}

              {/* ========================================================
                  TAB 2: COMPARTILHAMENTO DE TELA / TRANSMISSÃO
                  ======================================================== */}
              {activeTab === "screenshare" && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-xl font-bold text-white mb-1">Configurações de Transmissão</h2>
                    <p className="text-xs text-[#949ba4]">
                      Personalize a qualidade de vídeo padrão ao transmitir sua tela nos canais de voz.
                    </p>
                  </div>

                  {/* Resolution Selector */}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-[#b5bac1] uppercase tracking-wider">
                      Resolução da Transmissão
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                      {(["720p", "1080p", "1440p"] as ScreenResolution[]).map((res) => (
                        <button
                          key={res}
                          type="button"
                          onClick={() => setScreenShareResolution(res)}
                          className={`flex items-center justify-center p-3 rounded-lg border font-semibold text-sm transition cursor-pointer ${
                            screenShareResolution === res
                              ? "border-[#5865F2] bg-[#5865F2] text-white shadow-md"
                              : "border-[#1f2023] bg-[#2b2d31] text-[#dbdee1] hover:bg-[#35373c]"
                          }`}
                        >
                          {res}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Frame Rate (FPS) Selector */}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-[#b5bac1] uppercase tracking-wider">
                      Taxa de Quadros (FPS)
                    </label>
                    <div className="grid grid-cols-3 gap-3">
                      {([15, 30, 60] as ScreenFps[]).map((fps) => (
                        <button
                          key={fps}
                          type="button"
                          onClick={() => setScreenShareFps(fps)}
                          className={`flex items-center justify-center p-3 rounded-lg border font-semibold text-sm transition cursor-pointer ${
                            screenShareFps === fps
                              ? "border-[#5865F2] bg-[#5865F2] text-white shadow-md"
                              : "border-[#1f2023] bg-[#2b2d31] text-[#dbdee1] hover:bg-[#35373c]"
                          }`}
                        >
                          {fps} FPS
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Screen Share Volume */}
                  <div className="space-y-2 pt-2">
                    <label className="block text-xs font-bold text-[#b5bac1] uppercase tracking-wider">
                      Volume Padrão da Live ({screenShareVolume}%)
                    </label>
                    <div className="p-3.5 rounded-lg bg-[#2b2d31] border border-[#1f2023]/60">
                      <input
                        type="range"
                        min="0"
                        max="200"
                        value={screenShareVolume}
                        onChange={(e) => setScreenShareVolume(Number(e.target.value))}
                        className="w-full accent-[#5865F2] cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ========================================================
                  TAB 3: APARÊNCIA & TEMA
                  ======================================================== */}
              {activeTab === "appearance" && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-xl font-bold text-white mb-1">Aparência</h2>
                    <p className="text-xs text-[#949ba4]">
                      Personalize as cores e o tema da sua experiência no Concord.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <label className="block text-xs font-bold text-[#b5bac1] uppercase tracking-wider">
                      Tema
                    </label>
                    <div className="grid grid-cols-2 gap-4">
                      {/* Dark Theme */}
                      <button
                        type="button"
                        onClick={() => setTheme("dark")}
                        className={`flex flex-col items-center p-4 rounded-xl border transition cursor-pointer ${
                          theme === "dark"
                            ? "border-[#5865F2] bg-[#1e1f22] ring-2 ring-[#5865F2]"
                            : "border-[#1f2023] bg-[#2b2d31] hover:bg-[#35373c]"
                        }`}
                      >
                        <div className="w-full h-24 rounded-lg bg-[#111214] border border-[#2b2d31] mb-3 flex items-center justify-center">
                          <div className="w-16 h-8 rounded bg-[#5865F2] flex items-center justify-center text-[10px] font-bold text-white shadow">
                            Escuro
                          </div>
                        </div>
                        <span className="font-semibold text-sm text-white">Escuro (Padrão)</span>
                      </button>

                      {/* Light Theme */}
                      <button
                        type="button"
                        onClick={() => setTheme("light")}
                        className={`flex flex-col items-center p-4 rounded-xl border transition cursor-pointer ${
                          theme === "light"
                            ? "border-[#5865F2] bg-[#1e1f22] ring-2 ring-[#5865F2]"
                            : "border-[#1f2023] bg-[#2b2d31] hover:bg-[#35373c]"
                        }`}
                      >
                        <div className="w-full h-24 rounded-lg bg-[#f2f3f5] border border-[#e3e5e8] mb-3 flex items-center justify-center">
                          <div className="w-16 h-8 rounded bg-[#5865F2] flex items-center justify-center text-[10px] font-bold text-white shadow">
                            Claro
                          </div>
                        </div>
                        <span className="font-semibold text-sm text-white">Claro</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ========================================================
                  TAB 4: NOTIFICAÇÕES & DESKTOP
                  ======================================================== */}
              {activeTab === "notifications" && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-xl font-bold text-white mb-1">Notificações e Desktop</h2>
                    <p className="text-xs text-[#949ba4]">
                      Controle alertas nativos, sons e integração com a bandeja do Windows.
                    </p>
                  </div>

                  <div className="space-y-3 bg-[#2b2d31] p-4 rounded-lg border border-[#1f2023]/60">
                    {/* Desktop Notifications Toggle */}
                    <div className="flex items-center justify-between py-2">
                      <div>
                        <div className="text-sm font-semibold text-white">Notificações na Área de Trabalho</div>
                        <div className="text-xs text-[#949ba4]">
                          Receba alertas visuais no Windows quando receber novas mensagens ou menções.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleRequestNotificationPermission}
                        className={`px-3 py-1.5 rounded text-xs font-semibold transition cursor-pointer ${
                          notificationsEnabled
                            ? "bg-[#23a55a] text-white"
                            : "bg-[#35373c] text-[#dbdee1] hover:bg-[#404249]"
                        }`}
                      >
                        {notificationsEnabled ? "Ativado" : "Ativar Notificações"}
                      </button>
                    </div>

                    <div className="h-[1px] bg-[#1f2023]" />

                    {/* Notification Sounds Toggle */}
                    <label className="flex items-center justify-between py-2 cursor-pointer">
                      <div>
                        <div className="text-sm font-semibold text-white">Sons de Mensagem</div>
                        <div className="text-xs text-[#949ba4]">
                          Reproduzir som suave ao receber uma mensagem direta ou menção.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={soundEnabled}
                        onChange={(e) => setSoundEnabled(e.target.checked)}
                        className="accent-[#5865F2] w-4 h-4 rounded cursor-pointer"
                      />
                    </label>

                    <div className="h-[1px] bg-[#1f2023]" />

                    {/* Minimize to Tray */}
                    <label className="flex items-center justify-between py-2 cursor-pointer">
                      <div>
                        <div className="text-sm font-semibold text-white">Minimizar para a Bandeja do Sistema</div>
                        <div className="text-xs text-[#949ba4]">
                          Ao fechar ou minimizar, o Concord continua executando silenciosamente perto do relógio.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={minimizeToTray}
                        onChange={(e) => setMinimizeToTray(e.target.checked)}
                        className="accent-[#5865F2] w-4 h-4 rounded cursor-pointer"
                      />
                    </label>

                    <div className="h-[1px] bg-[#1f2023]" />

                    {/* Start with Windows */}
                    <label className="flex items-center justify-between py-2 cursor-pointer">
                      <div>
                        <div className="text-sm font-semibold text-white">Iniciar com o Windows</div>
                        <div className="text-xs text-[#949ba4]">
                          Abrir o Concord automaticamente ao ligar seu computador.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={startWithWindows}
                        onChange={(e) => setStartWithWindows(e.target.checked)}
                        className="accent-[#5865F2] w-4 h-4 rounded cursor-pointer"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
