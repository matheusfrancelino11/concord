package gateway

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"nhooyr.io/websocket"

	"concord/internal/models"
	"concord/internal/service"
	"concord/internal/snowflake"
)

// Handler serves HTTP WebSocket gateway requests
type Handler struct {
	hubManager      *HubManager
	sessionStore    *SessionStore
	presenceTracker *PresenceTracker
	authService     service.AuthService
	guildService    service.GuildService
	voiceService    service.VoiceService
}

// NewHandler constructs a new Gateway HTTP handler
func NewHandler(
	hubManager *HubManager,
	sessionStore *SessionStore,
	presenceTracker *PresenceTracker,
	authService service.AuthService,
	guildService service.GuildService,
	voiceService service.VoiceService,
) *Handler {
	return &Handler{
		hubManager:      hubManager,
		sessionStore:    sessionStore,
		presenceTracker: presenceTracker,
		authService:     authService,
		guildService:    guildService,
		voiceService:    voiceService,
	}
}

// ServeHTTP upgrades HTTP to WebSocket and manages Gateway lifecycle
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"*"}, // Permissive for Tauri v2 desktop apps
	})
	if err != nil {
		log.Printf("[gateway] WebSocket accept failed: %v", err)
		return
	}

	connCtx, connCancel := context.WithCancel(context.Background())
	defer connCancel()

	// If HTTP request context cancels (TCP drop), cancel connection context
	go func() {
		select {
		case <-r.Context().Done():
			connCancel()
		case <-connCtx.Done():
		}
	}()

	// 1. Send Opcode 10 HELLO
	helloBytes, err := NewHelloEnvelope(HeartbeatIntervalMs)
	if err != nil {
		_ = conn.Close(websocket.StatusInternalError, "failed to marshal hello")
		return
	}
	writeCtx, writeCancel := context.WithTimeout(connCtx, 5*time.Second)
	err = conn.Write(writeCtx, websocket.MessageText, helloBytes)
	writeCancel()
	if err != nil {
		_ = conn.Close(websocket.StatusInternalError, "failed to send hello")
		return
	}

	// 2. Handshake Phase: await IDENTIFY (Opcode 2) or RESUME (Opcode 6)
	handshakeDeadline := time.Now().Add(HandshakeTimeoutSec * time.Second)
	var client *Client

	for {
		rem := time.Until(handshakeDeadline)
		if rem <= 0 {
			_ = conn.Close(websocket.StatusCode(CloseCodeUnknownError), "Identify timeout")
			return
		}

		readCtx, readCancel := context.WithTimeout(connCtx, rem)
		_, data, readErr := conn.Read(readCtx)
		readCancel()

		if readErr != nil {
			_ = conn.Close(websocket.StatusCode(CloseCodeUnknownError), "Identify timeout")
			return
		}

		var env GatewayEnvelope
		if err := json.Unmarshal(data, &env); err != nil {
			_ = conn.Close(websocket.StatusPolicyViolation, "Malformed handshake frame")
			return
		}

		// Client can send Opcode 1 HEARTBEAT before IDENTIFY
		if env.Op == OpcodeHeartbeat {
			ack := NewHeartbeatACKEnvelope()
			hWriteCtx, hWriteCancel := context.WithTimeout(connCtx, 3*time.Second)
			_ = conn.Write(hWriteCtx, websocket.MessageText, ack)
			hWriteCancel()
			continue
		}

		// Handle Opcode 2 IDENTIFY
		if env.Op == OpcodeIdentify {
			var identify IdentifyData
			if err := json.Unmarshal(env.D, &identify); err != nil || identify.Token == "" {
				_ = conn.Close(websocket.StatusCode(CloseCodeAuthenticationFailed), "Authentication failed")
				return
			}

			claims, err := h.authService.ValidateToken(identify.Token, service.TokenTypeAccess)
			if err != nil {
				_ = conn.Close(websocket.StatusCode(CloseCodeAuthenticationFailed), "Authentication failed")
				return
			}

			userID, err := snowflake.Parse(claims.UserID)
			if err != nil {
				_ = conn.Close(websocket.StatusCode(CloseCodeAuthenticationFailed), "Authentication failed")
				return
			}

			user, err := h.authService.GetCurrentUser(connCtx, userID)
			if err != nil {
				_ = conn.Close(websocket.StatusCode(CloseCodeUnknownError), "User lookup failed")
				return
			}

			guilds, err := h.guildService.ListUserGuilds(connCtx, userID)
			if err != nil {
				_ = conn.Close(websocket.StatusCode(CloseCodeUnknownError), "Guild lookup failed")
				return
			}

			sBytes := make([]byte, 16)
			_, _ = rand.Read(sBytes)
			sessionID := hex.EncodeToString(sBytes)

			guildIDs := make([]snowflake.ID, len(guilds))
			guildStubs := make([]GuildStub, len(guilds))
			for i, g := range guilds {
				guildIDs[i] = g.ID
				guildStubs[i] = GuildStub{
					ID:          g.ID.String(),
					Unavailable: false,
				}
			}

			sessionRecord := h.sessionStore.CreateSession(sessionID, userID, guildIDs)
			client = NewClient(connCtx, conn, userID, sessionID, sessionRecord, h.sessionStore, 0)
			sessionRecord.SetActiveClient(client)

			// Dispatch READY (Opcode 0, seq: 1, event: "READY")
			readyData := ReadyData{
				V:         1,
				User:      user,
				Guilds:    guildStubs,
				SessionID: sessionID,
			}
			sessionRecord.Dispatch(EventReady, readyData)

			// Update presence tracking
			userStatus, becameOnline := h.presenceTracker.AddSession(userID, sessionID)

			// Dispatch GUILD_CREATE for each guild and subscribe to Hub
			for _, g := range guilds {
				guildDetail, err := h.guildService.GetGuildDetails(connCtx, userID, g.ID)
				if err == nil {
					// Attach active presences of members
					if len(guildDetail.Members) > 0 {
						memberIDs := make([]snowflake.ID, len(guildDetail.Members))
						for i, m := range guildDetail.Members {
							memberIDs[i] = m.UserID
						}
						presencesMap := h.presenceTracker.GetPresences(memberIDs)
						presences := make([]models.Presence, 0, len(presencesMap))
						for uid, st := range presencesMap {
							presences = append(presences, models.Presence{
								UserID:  uid,
								Status:  st,
								GuildID: &g.ID,
								ClientStatus: map[string]string{
									"desktop": st,
								},
							})
						}
						guildDetail.Presences = presences
					}

					// Attach voice states
					if h.voiceService != nil {
						voiceStates, _ := h.voiceService.GetGuildVoiceStates(connCtx, g.ID)
						guildDetail.VoiceStates = voiceStates
					}

					sessionRecord.Dispatch(EventGuildCreate, guildDetail)
				}
				hub := h.hubManager.GetOrCreateHub(g.ID.String())
				hub.Register(sessionRecord)
				sessionRecord.AddHub(hub)

				// If user became online, broadcast PRESENCE_UPDATE to other members of this guild
				if becameOnline {
					h.hubManager.BroadcastToGuildExcept(g.ID, EventPresenceUpdate, models.Presence{
						UserID:  userID,
						Status:  userStatus,
						GuildID: &g.ID,
						ClientStatus: map[string]string{
							"desktop": userStatus,
						},
					}, sessionID)
				}
			}

			break // Handshake succeeded
		}

		// Handle Opcode 6 RESUME
		if env.Op == OpcodeResume {
			var resume ResumeData
			if err := json.Unmarshal(env.D, &resume); err != nil || resume.Token == "" || resume.SessionID == "" {
				_ = conn.Write(connCtx, websocket.MessageText, NewInvalidSessionEnvelope(false))
				_ = conn.Close(websocket.StatusCode(CloseCodeAuthenticationFailed), "Invalid resume")
				return
			}

			claims, err := h.authService.ValidateToken(resume.Token, service.TokenTypeAccess)
			if err != nil {
				_ = conn.Write(connCtx, websocket.MessageText, NewInvalidSessionEnvelope(false))
				_ = conn.Close(websocket.StatusCode(CloseCodeAuthenticationFailed), "Authentication failed")
				return
			}

			sessionRecord, exists := h.sessionStore.GetSession(resume.SessionID)
			if !exists || sessionRecord.UserID.String() != claims.UserID {
				_ = conn.Write(connCtx, websocket.MessageText, NewInvalidSessionEnvelope(false))
				_ = conn.Close(websocket.StatusCode(CloseCodeUnknownError), "Invalid session")
				return
			}

			missed, ok := sessionRecord.GetMissedEvents(resume.Seq)
			if !ok {
				_ = conn.Write(connCtx, websocket.MessageText, NewInvalidSessionEnvelope(false))
				_ = conn.Close(websocket.StatusCode(CloseCodeInvalidSeq), "Invalid sequence")
				return
			}

			client = NewClient(connCtx, conn, sessionRecord.UserID, sessionRecord.SessionID, sessionRecord, h.sessionStore, sessionRecord.LastSeq)
			sessionRecord.SetActiveClient(client)

			// Replay missed events
			for _, ev := range missed {
				client.SendRaw(ev.Data)
			}

			// Send RESUMED event
			resumedData, _ := NewDispatchEnvelope(sessionRecord.LastSeq, EventResumed, map[string]any{})
			client.SendRaw(resumedData)

			// Ensure session is registered in guild Hubs
			for _, gid := range sessionRecord.GuildIDs {
				hub := h.hubManager.GetOrCreateHub(gid.String())
				hub.Register(sessionRecord)
			}

			break // Resume handshake succeeded
		}

		// Unrecognized opcode before authentication
		_ = conn.Close(websocket.StatusCode(CloseCodeUnknownError), "Invalid initial opcode")
		return
	}

	// 3. Active Connection Loop
	go client.WritePump()

	// Zombie Connection Monitor
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-client.ctx.Done():
				return
			case <-ticker.C:
				elapsed := time.Since(client.LastHeartbeatTime())
				if elapsed > time.Duration(ZombieTimeoutMs)*time.Millisecond {
					log.Printf("[gateway] Zombie connection detected for client %s (elapsed %v). Closing.", client.ID(), elapsed)
					client.CloseWithCode(websocket.StatusPolicyViolation, "Heartbeat timeout")
					return
				}
			}
		}
	}()

	// ReadPump in current handler goroutine
	defer func() {
		client.CloseWithCode(websocket.StatusNormalClosure, "Connection terminating")

		// Remove presence session
		becameOffline := h.presenceTracker.RemoveSession(client.UserID(), client.SessionID())
		if becameOffline {
			for _, gid := range client.session.GuildIDs {
				h.hubManager.BroadcastToGuildExcept(gid, EventPresenceUpdate, models.Presence{
					UserID:  client.UserID(),
					Status:  models.StatusOffline,
					GuildID: &gid,
					ClientStatus: map[string]string{
						"desktop": models.StatusOffline,
					},
				}, client.SessionID())
			}
		}

		// Clear voice states for this session
		if h.voiceService != nil {
			cleared, err := h.voiceService.ClearVoiceStatesForSession(context.Background(), client.UserID(), client.SessionID())
			if err == nil {
				for _, vs := range cleared {
					h.hubManager.BroadcastToGuild(vs.GuildID, EventVoiceStateUpdate, vs)
				}
			}
		}
	}()

	for {
		_, data, err := conn.Read(client.ctx)
		if err != nil {
			return
		}

		var incoming GatewayEnvelope
		if err := json.Unmarshal(data, &incoming); err != nil {
			continue
		}

		switch incoming.Op {
		case OpcodeHeartbeat:
			client.TouchHeartbeat()
			client.SendRaw(NewHeartbeatACKEnvelope())

		case OpcodeIdentify:
			// Protocol violation: sending IDENTIFY when already authenticated
			client.CloseWithCode(websocket.StatusCode(CloseCodeAlreadyAuthenticated), "Already authenticated")
			return

		case OpcodePresenceUpdate:
			var req models.PresenceUpdateRequest
			if err := json.Unmarshal(incoming.D, &req); err == nil {
				newStatus := h.presenceTracker.SetStatus(client.UserID(), req.Status)
				effectiveStatus := newStatus
				if effectiveStatus == models.StatusInvisible {
					effectiveStatus = models.StatusOffline
				}
				for _, gid := range client.session.GuildIDs {
					h.hubManager.BroadcastToGuild(gid, EventPresenceUpdate, models.Presence{
						UserID:  client.UserID(),
						Status:  effectiveStatus,
						GuildID: &gid,
						ClientStatus: map[string]string{
							"desktop": effectiveStatus,
						},
					})
				}
			}

		case OpcodeVoiceStateUpdate:
			if h.voiceService != nil {
				var req models.VoiceStateUpdateRequest
				if err := json.Unmarshal(incoming.D, &req); err == nil {
					vs, err := h.voiceService.UpdateVoiceState(client.ctx, client.UserID(), client.SessionID(), &req)
					if err == nil && vs != nil {
						h.hubManager.BroadcastToGuild(req.GuildID, EventVoiceStateUpdate, vs)
					}
				}
			}

		default:
			// Other opcodes ignored or logged
		}
	}
}
