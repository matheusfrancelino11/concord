package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"concord/internal/api"
	"concord/internal/config"
	"concord/internal/database"
	"concord/internal/middleware"
	"concord/internal/service"
	"concord/internal/snowflake"
)

func main() {
	log.Println("[concord] Starting Concord Backend Server...")

	cfg := config.Load()
	log.Printf("[concord] Environment: %s | Port: %s", cfg.Env, cfg.Port)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := database.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("[concord] Fatal DB connection error: %v", err)
	}
	defer pool.Close()

	log.Println("[concord] Running database migrations...")
	if err := database.RunMigrations(ctx, pool); err != nil {
		log.Fatalf("[concord] Fatal migration failure: %v", err)
	}
	log.Println("[concord] Database migrations completed successfully.")

	sf, err := snowflake.New(cfg.WorkerID, cfg.ProcessID)
	if err != nil {
		log.Fatalf("[concord] Fatal Snowflake initialization error: %v", err)
	}
	_ = snowflake.InitDefault(cfg.WorkerID, cfg.ProcessID)

	authService := service.NewAuthService(pool, sf, cfg.JWTSecret)
	guildService := service.NewGuildService(pool, sf)
	channelService := service.NewChannelService(pool, sf)

	authMiddleware := middleware.NewAuthMiddleware(authService)

	authHandler := api.NewAuthHandler(authService)
	guildHandler := api.NewGuildHandler(guildService, channelService)
	channelHandler := api.NewChannelHandler(channelService)

	router := api.NewRouter(&api.RouterDeps{
		Config:         cfg,
		Pool:           pool,
		AuthHandler:    authHandler,
		GuildHandler:   guildHandler,
		ChannelHandler: channelHandler,
		AuthMiddleware: authMiddleware,
	})

	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	shutdownSignal := make(chan os.Signal, 1)
	signal.Notify(shutdownSignal, os.Interrupt, syscall.SIGTERM)

	serverErrors := make(chan error, 1)
	go func() {
		log.Printf("[concord] HTTP Server listening on port %s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErrors <- err
		}
	}()

	select {
	case err := <-serverErrors:
		log.Fatalf("[concord] Server startup error: %v", err)
	case sig := <-shutdownSignal:
		log.Printf("[concord] Shutdown signal received: %v. Initiating graceful shutdown...", sig)
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()

		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("[concord] Error during server shutdown: %v", err)
			_ = server.Close()
		}
	}

	log.Println("[concord] Concord backend server stopped cleanly.")
}
