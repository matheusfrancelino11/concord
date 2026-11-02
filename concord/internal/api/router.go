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
	AuthMiddleware *middleware.AuthMiddleware
}

// NewRouter constructs the Chi router with standard middleware and routes
func NewRouter(deps *RouterDeps) http.Handler {
	r := chi.NewRouter()

	// Global standard middlewares
	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.RealIP)
	r.Use(chimiddleware.Logger)
	r.Use(chimiddleware.Recoverer)
	r.Use(chimiddleware.Timeout(30 * time.Second))
	r.Use(middleware.NewCORS(deps.Config.CORSOrigins))

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

	// Mount health endpoints
	r.Get("/health", healthHandler)
	r.Get("/v1/health", healthHandler)

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
		})
	}

	r.Group(registerAPIRoutes)
	r.Route("/v1", registerAPIRoutes)

	return r
}
