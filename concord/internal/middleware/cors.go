package middleware

import (
	"net/http"
	"strings"

	"github.com/go-chi/cors"
)

// NewCORS creates configured CORS middleware for Tauri desktop & web frontend
func NewCORS(allowedOrigins []string) func(http.Handler) http.Handler {
	originMap := make(map[string]bool)
	for _, o := range allowedOrigins {
		originMap[o] = true
	}

	return cors.Handler(cors.Options{
		AllowOriginFunc: func(r *http.Request, origin string) bool {
			if originMap[origin] || originMap["*"] {
				return true
			}
			// Allow all localhost, 127.0.0.1, and tauri desktop origins
			if strings.HasPrefix(origin, "http://localhost:") ||
				strings.HasPrefix(origin, "http://127.0.0.1:") ||
				strings.HasPrefix(origin, "https://localhost:") ||
				origin == "tauri://localhost" ||
				origin == "http://tauri.localhost" ||
				origin == "https://tauri.localhost" {
				return true
			}
			return false
		},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	})
}
