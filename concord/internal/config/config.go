package config

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds runtime configuration settings for the backend service
type Config struct {
	Port             string
	DatabaseURL      string
	JWTSecret        string
	JWTExpiry        time.Duration
	JWTRefreshExpiry time.Duration
	Env              string
	WorkerID         int64
	ProcessID        int64
	CORSOrigins      []string
	LiveKitURL       string
	LiveKitKey       string
	LiveKitSecret    string
}

// Load reads configuration from environment variables with fallback defaults.
// It also parses a local .env file if one exists.
func Load() *Config {
	loadDotEnv(".env")

	port := getEnv("PORT", "8080")
	dbURL := getEnv("DATABASE_URL", "postgres://concord:concord@127.0.0.1:5432/concord?sslmode=disable")
	jwtSecret := getEnv("JWT_SECRET", "dev_secret_change_in_production_key")
	env := getEnv("ENV", "development")

	livekitURL := getEnv("LIVEKIT_URL", "ws://127.0.0.1:7880")
	livekitKey := getEnv("LIVEKIT_KEY", "devkey")
	livekitSecret := getEnv("LIVEKIT_SECRET", "secret")

	workerID := getEnvInt64("WORKER_ID", 1)
	processID := getEnvInt64("PROCESS_ID", 1)

	jwtExpiryHours := getEnvInt("JWT_EXPIRY_HOURS", 1)
	jwtRefreshDays := getEnvInt("JWT_REFRESH_EXPIRY_DAYS", 30)

	corsStr := getEnv("CORS_ORIGINS", "tauri://localhost,http://tauri.localhost,https://tauri.localhost,http://localhost:1420,http://127.0.0.1:1420,http://localhost:5173,http://127.0.0.1:5173")
	var origins []string
	for _, o := range strings.Split(corsStr, ",") {
		o = strings.TrimSpace(o)
		if o != "" {
			origins = append(origins, o)
		}
	}

	return &Config{
		Port:             port,
		DatabaseURL:      dbURL,
		JWTSecret:        jwtSecret,
		JWTExpiry:        time.Duration(jwtExpiryHours) * time.Hour,
		JWTRefreshExpiry: time.Duration(jwtRefreshDays) * 24 * time.Hour,
		Env:              env,
		WorkerID:         workerID,
		ProcessID:        processID,
		CORSOrigins:      origins,
		LiveKitURL:       livekitURL,
		LiveKitKey:       livekitKey,
		LiveKitSecret:    livekitSecret,
	}
}

func getEnv(key, fallback string) string {
	if val, ok := os.LookupEnv(key); ok && val != "" {
		return strings.TrimSpace(val)
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if val, ok := os.LookupEnv(key); ok {
		if n, err := strconv.Atoi(strings.TrimSpace(val)); err == nil {
			return n
		}
	}
	return fallback
}

func getEnvInt64(key string, fallback int64) int64 {
	if val, ok := os.LookupEnv(key); ok {
		if n, err := strconv.ParseInt(strings.TrimSpace(val), 10, 64); err == nil {
			return n
		}
	}
	return fallback
}

func loadDotEnv(filepath string) {
	file, err := os.Open(filepath)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			k := strings.TrimSpace(parts[0])
			v := strings.Trim(strings.TrimSpace(parts[1]), "\"'")
			if _, exists := os.LookupEnv(k); !exists {
				_ = os.Setenv(k, v)
			}
		}
	}
}
