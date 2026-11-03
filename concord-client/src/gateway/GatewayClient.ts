import {
  GatewayOpcode,
  GatewayPayload,
  GatewayEvent,
  GatewayEventType,
} from "../types";
import { API_BASE_URL, getAccessToken } from "../api/client";

export type ConnectionStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "HANDSHAKING"
  | "CONNECTED"
  | "RECONNECTING";

export type EventHandler<T = any> = (data: T) => void;
export type StatusListener = (status: ConnectionStatus) => void;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = "DISCONNECTED";
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private initialHeartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  private heartbeatAckReceived: boolean = true;
  private heartbeatInterval: number = 41250;
  private sequence: number | null = null;
  private sessionId: string | null = null;
  private reconnectAttempts: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isExplicitDisconnect: boolean = false;
  private customUrl?: string;

  private listeners: Map<string, Set<EventHandler>> = new Map();
  private statusListeners: Set<StatusListener> = new Set();

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  public getSessionId(): string | null {
    return this.sessionId;
  }

  public getSequence(): number | null {
    return this.sequence;
  }

  public connect(customUrl?: string): void {
    if (customUrl) {
      this.customUrl = customUrl;
    }

    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.isExplicitDisconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const token = getAccessToken();
    if (!token) {
      this.setStatus("DISCONNECTED");
      return;
    }

    this.setStatus(this.reconnectAttempts > 0 ? "RECONNECTING" : "CONNECTING");

    const wsUrl =
      this.customUrl ||
      ((import.meta as any).env?.VITE_GATEWAY_URL as string | undefined) ||
      API_BASE_URL.replace(/^http/, "ws") + "/gateway";

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onerror = this.handleError.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
    } catch (err) {
      console.error("[GatewayClient] WebSocket creation failed:", err);
      this.scheduleReconnect();
    }
  }

  public disconnect(): void {
    this.isExplicitDisconnect = true;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.close(1000, "Normal Closure");
      } catch {
        // Ignore close error during teardown
      }
      this.ws = null;
    }

    this.setStatus("DISCONNECTED");
  }

  private handleOpen(): void {
    this.setStatus("HANDSHAKING");
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const payload: GatewayPayload = JSON.parse(event.data);

      if (payload.s !== undefined && payload.s !== null) {
        this.sequence = payload.s;
      }

      switch (payload.op) {
        case GatewayOpcode.HELLO: {
          const helloData = payload.d as { heartbeat_interval: number };
          if (helloData && helloData.heartbeat_interval) {
            this.heartbeatInterval = helloData.heartbeat_interval;
          }
          this.startHeartbeat(this.heartbeatInterval);
          this.sendIdentifyOrResume();
          break;
        }

        case GatewayOpcode.HEARTBEAT_ACK: {
          this.heartbeatAckReceived = true;
          break;
        }

        case GatewayOpcode.HEARTBEAT: {
          this.sendHeartbeat();
          break;
        }

        case GatewayOpcode.DISPATCH: {
          if (payload.t === GatewayEvent.READY) {
            const readyData = payload.d as { session_id: string };
            if (readyData && readyData.session_id) {
              this.sessionId = readyData.session_id;
            }
            this.reconnectAttempts = 0;
            this.setStatus("CONNECTED");
          } else if (payload.t === GatewayEvent.RESUMED) {
            this.reconnectAttempts = 0;
            this.setStatus("CONNECTED");
          }

          if (payload.t) {
            this.emit(payload.t, payload.d);
            this.emit("*", { event: payload.t, data: payload.d });
          }
          break;
        }

        case GatewayOpcode.INVALID_SESSION: {
          const resumable = Boolean(payload.d);
          if (!resumable) {
            this.sessionId = null;
            this.sequence = null;
          }
          setTimeout(() => {
            this.sendIdentifyOrResume();
          }, 1000);
          break;
        }

        case GatewayOpcode.RECONNECT: {
          if (this.ws) {
            this.ws.close(4000, "Server requested reconnect");
          }
          break;
        }
      }
    } catch (err) {
      console.error("[GatewayClient] Error parsing message:", err);
    }
  }

  private sendIdentifyOrResume(): void {
    const token = getAccessToken();
    if (!token) {
      this.disconnect();
      return;
    }

    if (this.sessionId && this.sequence !== null) {
      // Resume existing session
      this.send({
        op: GatewayOpcode.RESUME,
        d: {
          token,
          session_id: this.sessionId,
          seq: this.sequence,
        },
      });
    } else {
      // Full Identify handshake
      this.send({
        op: GatewayOpcode.IDENTIFY,
        d: {
          token,
          properties: {
            os: typeof navigator !== "undefined" ? navigator.platform || "unknown" : "desktop",
            browser: "Concord Client",
          },
        },
      });
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatAckReceived = true;

    // First heartbeat randomized with jitter
    const initialJitter = Math.floor(intervalMs * Math.random());
    this.initialHeartbeatTimeout = setTimeout(() => {
      this.sendHeartbeat();

      this.heartbeatTimer = setInterval(() => {
        if (!this.heartbeatAckReceived) {
          console.warn("[GatewayClient] Heartbeat ACK missed. Zombie connection detected.");
          if (this.ws) {
            this.ws.close(4000, "Zombie Connection Timeout");
          }
          return;
        }
        this.sendHeartbeat();
      }, intervalMs);
    }, initialJitter);
  }

  private sendHeartbeat(): void {
    this.heartbeatAckReceived = false;
    this.send({
      op: GatewayOpcode.HEARTBEAT,
      d: this.sequence,
    });
  }

  private stopHeartbeat(): void {
    if (this.initialHeartbeatTimeout) {
      clearTimeout(this.initialHeartbeatTimeout);
      this.initialHeartbeatTimeout = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private handleClose(event: CloseEvent): void {
    this.stopHeartbeat();

    if (this.isExplicitDisconnect) {
      this.setStatus("DISCONNECTED");
      return;
    }

    // Close code 4004 = Authentication Failed (token invalid/expired)
    if (event.code === 4004) {
      console.warn("[GatewayClient] Authentication failed (4004). Halting reconnect.");
      this.sessionId = null;
      this.sequence = null;
      this.setStatus("DISCONNECTED");
      return;
    }

    this.scheduleReconnect();
  }

  private handleError(error: Event): void {
    console.error("[GatewayClient] WebSocket error event:", error);
    // ws.onerror is consistently followed by ws.onclose
  }

  private scheduleReconnect(): void {
    if (this.isExplicitDisconnect) return;
    this.setStatus("RECONNECTING");

    const delay = Math.min(
      30000,
      1000 * Math.pow(2, this.reconnectAttempts) + Math.floor(Math.random() * 1000)
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  public send(payload: GatewayPayload): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((fn) => {
      try {
        fn(status);
      } catch (err) {
        console.error("[GatewayClient] Error in status listener:", err);
      }
    });
  }

  public onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public on<T = any>(event: GatewayEventType | string, handler: EventHandler<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  public off(event: GatewayEventType | string, handler: EventHandler): void {
    this.listeners.get(event)?.delete(handler);
  }

  public sendPresenceUpdate(status: string): void {
    this.send({
      op: GatewayOpcode.PRESENCE_UPDATE,
      d: { status },
    });
  }

  public sendVoiceStateUpdate(
    guildId: string,
    channelId: string | null,
    options?: { self_mute?: boolean; self_deaf?: boolean; self_video?: boolean; self_stream?: boolean }
  ): void {
    this.send({
      op: GatewayOpcode.VOICE_STATE_UPDATE,
      d: {
        guild_id: guildId,
        channel_id: channelId,
        self_mute: options?.self_mute ?? false,
        self_deaf: options?.self_deaf ?? false,
        self_video: options?.self_video ?? false,
        self_stream: options?.self_stream ?? false,
      },
    });
  }

  private emit(event: string, data: any): void {
    this.listeners.get(event)?.forEach((fn) => {
      try {
        fn(data);
      } catch (err) {
        console.error(`[GatewayClient] Error in event listener for ${event}:`, err);
      }
    });
  }
}

export const gateway = new GatewayClient();
export const getGatewayClient = () => gateway;
