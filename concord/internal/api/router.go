package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"concord/internal/config"
	"concord/internal/middleware"
)

// RouterDeps contains dependencies required to construct the HTTP router
type RouterDeps struct {
	Config         *config.Config
	Pool           *pgxpool.Pool
	AuthHandler    *AuthHandler
	GuildHandler   *GuildHandler
	ChannelHandler *ChannelHandler
	MessageHandler *MessageHandler
	InviteHandler  *InviteHandler
	VoiceHandler   *VoiceHandler
	AdminHandler   *AdminHandler
	GatewayHandler http.Handler
	AuthMiddleware *middleware.AuthMiddleware
}

// NewRouter constructs the Chi router with standard middleware and routes
func NewRouter(deps *RouterDeps) http.Handler {
	r := chi.NewRouter()

	// Global standard middlewares (without Request Timeout so WebSockets are not aborted)
	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.RealIP)
	r.Use(chimiddleware.Logger)
	r.Use(chimiddleware.Recoverer)
	r.Use(middleware.NewCORS(deps.Config.CORSOrigins))

	// Mount WebSocket Gateway endpoints directly on root router (outside Timeout middleware)
	if deps.GatewayHandler != nil {
		r.Get("/gateway", deps.GatewayHandler.ServeHTTP)
		r.Get("/v1/gateway", deps.GatewayHandler.ServeHTTP)
	}

	// Health check handler
	healthHandler := func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		dbStatus := "healthy"
		httpStatus := http.StatusOK
		if err := deps.Pool.Ping(ctx); err != nil {
			dbStatus = "unhealthy"
			httpStatus = http.StatusServiceUnavailable
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(httpStatus)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "ok",
			"time":   time.Now().UTC().Format(time.RFC3339),
			"db":     dbStatus,
			"env":    deps.Config.Env,
		})
	}

	// API Route registry function supporting both root and /v1 prefix
	registerAPIRoutes := func(api chi.Router) {
		// Public Auth routes
		api.Post("/auth/register", deps.AuthHandler.Register)
		api.Post("/auth/login", deps.AuthHandler.Login)
		api.Post("/auth/refresh", deps.AuthHandler.Refresh)

		// Protected routes
		api.Group(func(pr chi.Router) {
			pr.Use(deps.AuthMiddleware.RequireAuth)

			// Current user profile
			pr.Get("/auth/me", deps.AuthHandler.Me)

			// Guild routes
			pr.Post("/guilds", deps.GuildHandler.CreateGuild)
			pr.Get("/guilds", deps.GuildHandler.ListGuilds)
			pr.Get("/guilds/{id}", deps.GuildHandler.GetGuildDetails)
			pr.Delete("/guilds/{id}", deps.GuildHandler.DeleteGuild)

			// Guild channel routes
			pr.Post("/guilds/{id}/channels", deps.GuildHandler.CreateChannel)
			pr.Get("/guilds/{id}/channels", deps.GuildHandler.ListChannels)

			// Direct channel routes
			pr.Delete("/channels/{id}", deps.ChannelHandler.DeleteChannel)

			// Milestone 2 Message routes
			if deps.MessageHandler != nil {
				pr.Get("/channels/{id}/messages", deps.MessageHandler.ListMessages)
				pr.Post("/channels/{id}/messages", deps.MessageHandler.CreateMessage)
				pr.Patch("/channels/{id}/messages/{mid}", deps.MessageHandler.UpdateMessage)
				pr.Delete("/channels/{id}/messages/{mid}", deps.MessageHandler.DeleteMessage)
				pr.Post("/channels/{id}/typing", deps.MessageHandler.TriggerTyping)
			}

			// Milestone 3 Invite and Member routes
			if deps.InviteHandler != nil {
				pr.Post("/guilds/{id}/invites", deps.InviteHandler.CreateInvite)
				pr.Get("/guilds/{id}/members", deps.InviteHandler.ListMembers)
				pr.Get("/invites/{code}", deps.InviteHandler.GetInvite)
				pr.Post("/invites/{code}/use", deps.InviteHandler.UseInvite)
			}

			// Milestone 4 Voice routes
			if deps.VoiceHandler != nil {
				pr.Post("/channels/{id}/voice/token", deps.VoiceHandler.GenerateToken)
				pr.Post("/channels/{id}/voice-token", deps.VoiceHandler.GenerateToken)
			}

			// Milestone 6 Administration & Permissions
			if deps.AdminHandler != nil {
				// Server update
				pr.Patch("/guilds/{id}", deps.AdminHandler.UpdateGuild)

				// Roles
				pr.Get("/guilds/{id}/roles", deps.AdminHandler.ListRoles)
				pr.Post("/guilds/{id}/roles", deps.AdminHandler.CreateRole)
				pr.Patch("/guilds/{id}/roles/{roleId}", deps.AdminHandler.UpdateRole)
				pr.Delete("/guilds/{id}/roles/{roleId}", deps.AdminHandler.DeleteRole)

				// Member Roles & Moderation
				pr.Put("/guilds/{id}/members/{uid}/roles/{roleId}", deps.AdminHandler.AddMemberRole)
				pr.Delete("/guilds/{id}/members/{uid}/roles/{roleId}", deps.AdminHandler.RemoveMemberRole)
				pr.Patch("/guilds/{id}/members/{uid}", deps.AdminHandler.UpdateMember)
				pr.Delete("/guilds/{id}/members/{uid}", deps.AdminHandler.KickMember)

				// Bans
				pr.Get("/guilds/{id}/bans", deps.AdminHandler.ListBans)
				pr.Put("/guilds/{id}/bans/{uid}", deps.AdminHandler.BanMember)
				pr.Delete("/guilds/{id}/bans/{uid}", deps.AdminHandler.UnbanMember)

				// Channel Overwrites
				pr.Put("/channels/{id}/permissions/{targetId}", deps.AdminHandler.SetChannelOverwrite)
				pr.Delete("/channels/{id}/permissions/{targetId}", deps.AdminHandler.DeleteChannelOverwrite)
			}
		})
	}

	// HTTP routes wrapped with 30-second request timeout
	r.Group(func(httpRouter chi.Router) {
		httpRouter.Use(chimiddleware.Timeout(30 * time.Second))

		// Health endpoints
		httpRouter.Get("/health", healthHandler)
		httpRouter.Get("/v1/health", healthHandler)

		// Mount API routes at root and /v1
		httpRouter.Group(registerAPIRoutes)
		httpRouter.Route("/v1", registerAPIRoutes)
	})

	return r
}
