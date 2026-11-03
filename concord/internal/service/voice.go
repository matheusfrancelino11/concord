package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/livekit/protocol/auth"

	"concord/internal/models"
	"concord/internal/snowflake"
)

// VoiceService manages voice states in PostgreSQL and LiveKit token generation
type VoiceService interface {
	UpdateVoiceState(ctx context.Context, userID snowflake.ID, sessionID string, req *models.VoiceStateUpdateRequest) (*models.VoiceState, error)
	GetGuildVoiceStates(ctx context.Context, guildID snowflake.ID) ([]models.VoiceState, error)
	ClearVoiceStatesForSession(ctx context.Context, userID snowflake.ID, sessionID string) ([]models.VoiceState, error)
	GenerateVoiceToken(ctx context.Context, userID snowflake.ID, channelID snowflake.ID) (*models.VoiceTokenResponse, error)
}

type voiceService struct {
	db            *pgxpool.Pool
	livekitURL    string
	livekitKey    string
	livekitSecret string
}

// NewVoiceService constructs a new VoiceService
func NewVoiceService(db *pgxpool.Pool, livekitURL, livekitKey, livekitSecret string) VoiceService {
	return &voiceService{
		db:            db,
		livekitURL:    livekitURL,
		livekitKey:    livekitKey,
		livekitSecret: livekitSecret,
	}
}

// UpdateVoiceState updates or removes a user's voice connection state in a guild
func (s *voiceService) UpdateVoiceState(
	ctx context.Context,
	userID snowflake.ID,
	sessionID string,
	req *models.VoiceStateUpdateRequest,
) (*models.VoiceState, error) {
	// If channel_id is nil, the user is leaving voice
	if req.ChannelID == nil {
		const deleteSQL = `
			DELETE FROM voice_states
			WHERE guild_id = $1 AND user_id = $2
			RETURNING guild_id, user_id
		`
		var gID, uID snowflake.ID
		_ = s.db.QueryRow(ctx, deleteSQL, req.GuildID, userID).Scan(&gID, &uID)

		return &models.VoiceState{
			GuildID:   req.GuildID,
			ChannelID: nil,
			UserID:    userID,
			SessionID: sessionID,
		}, nil
	}

	// Verify caller is a guild member
	var isMember bool
	checkSQL := `SELECT EXISTS(SELECT 1 FROM members WHERE guild_id = $1 AND user_id = $2)`
	if err := s.db.QueryRow(ctx, checkSQL, req.GuildID, userID).Scan(&isMember); err != nil || !isMember {
		return nil, ErrForbidden
	}

	const upsertSQL = `
		INSERT INTO voice_states (
			guild_id, channel_id, user_id, session_id,
			self_mute, self_deaf, self_video, self_stream,
			server_mute, server_deaf
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, FALSE)
		ON CONFLICT (guild_id, user_id) DO UPDATE SET
			channel_id = EXCLUDED.channel_id,
			session_id = EXCLUDED.session_id,
			self_mute = EXCLUDED.self_mute,
			self_deaf = EXCLUDED.self_deaf,
			self_video = EXCLUDED.self_video,
			self_stream = EXCLUDED.self_stream
		RETURNING guild_id, channel_id, user_id, session_id,
		          self_mute, self_deaf, self_video, self_stream,
		          server_mute, server_deaf
	`

	var vs models.VoiceState
	err := s.db.QueryRow(
		ctx,
		upsertSQL,
		req.GuildID,
		req.ChannelID,
		userID,
		sessionID,
		req.SelfMute,
		req.SelfDeaf,
		req.SelfVideo,
		req.SelfStream,
	).Scan(
		&vs.GuildID,
		&vs.ChannelID,
		&vs.UserID,
		&vs.SessionID,
		&vs.SelfMute,
		&vs.SelfDeaf,
		&vs.SelfVideo,
		&vs.SelfStream,
		&vs.ServerMute,
		&vs.ServerDeaf,
	)
	if err != nil {
		return nil, fmt.Errorf("upsert voice state: %w", err)
	}

	// Fetch user details for embedded member
	userSQL := `SELECT id, username, global_name, avatar FROM users WHERE id = $1`
	var u models.UserSummary
	if err := s.db.QueryRow(ctx, userSQL, userID).Scan(&u.ID, &u.Username, &u.GlobalName, &u.Avatar); err == nil {
		vs.Member = &models.MemberResponse{
			GuildID: req.GuildID,
			UserID:  userID,
			User:    u,
		}
	}

	return &vs, nil
}

// GetGuildVoiceStates returns all active voice states for a guild
func (s *voiceService) GetGuildVoiceStates(ctx context.Context, guildID snowflake.ID) ([]models.VoiceState, error) {
	const selectSQL = `
		SELECT vs.guild_id, vs.channel_id, vs.user_id, vs.session_id,
		       vs.self_mute, vs.self_deaf, vs.self_video, vs.self_stream,
		       vs.server_mute, vs.server_deaf,
		       u.id, u.username, u.global_name, u.avatar
		FROM voice_states vs
		JOIN users u ON vs.user_id = u.id
		WHERE vs.guild_id = $1 AND vs.channel_id IS NOT NULL
	`

	rows, err := s.db.Query(ctx, selectSQL, guildID)
	if err != nil {
		return nil, fmt.Errorf("query voice states: %w", err)
	}
	defer rows.Close()

	var result []models.VoiceState
	for rows.Next() {
		var vs models.VoiceState
		var u models.UserSummary
		if err := rows.Scan(
			&vs.GuildID,
			&vs.ChannelID,
			&vs.UserID,
			&vs.SessionID,
			&vs.SelfMute,
			&vs.SelfDeaf,
			&vs.SelfVideo,
			&vs.SelfStream,
			&vs.ServerMute,
			&vs.ServerDeaf,
			&u.ID,
			&u.Username,
			&u.GlobalName,
			&u.Avatar,
		); err != nil {
			return nil, fmt.Errorf("scan voice state: %w", err)
		}
		vs.Member = &models.MemberResponse{
			GuildID: vs.GuildID,
			UserID:  vs.UserID,
			User:    u,
		}
		result = append(result, vs)
	}

	return result, nil
}

// ClearVoiceStatesForSession removes voice states for a disconnected session
func (s *voiceService) ClearVoiceStatesForSession(ctx context.Context, userID snowflake.ID, sessionID string) ([]models.VoiceState, error) {
	const deleteSQL = `
		DELETE FROM voice_states
		WHERE user_id = $1 AND session_id = $2
		RETURNING guild_id, channel_id, user_id, session_id
	`
	rows, err := s.db.Query(ctx, deleteSQL, userID, sessionID)
	if err != nil {
		return nil, fmt.Errorf("delete voice states for session: %w", err)
	}
	defer rows.Close()

	var cleared []models.VoiceState
	for rows.Next() {
		var vs models.VoiceState
		if err := rows.Scan(&vs.GuildID, &vs.ChannelID, &vs.UserID, &vs.SessionID); err == nil {
			vs.ChannelID = nil // Signifies disconnected
			cleared = append(cleared, vs)
		}
	}

	return cleared, nil
}

// GenerateVoiceToken generates a LiveKit room join JWT for a user in a voice channel
func (s *voiceService) GenerateVoiceToken(ctx context.Context, userID snowflake.ID, channelID snowflake.ID) (*models.VoiceTokenResponse, error) {
	// 1. Verify channel exists and is a voice channel
	var guildID snowflake.ID
	var channelType int
	err := s.db.QueryRow(ctx, `SELECT guild_id, type FROM channels WHERE id = $1`, channelID).Scan(&guildID, &channelType)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrChannelNotFound
		}
		return nil, fmt.Errorf("query channel: %w", err)
	}

	if channelType != models.ChannelTypeVoice {
		return nil, ErrInvalidChannelType
	}

	// 2. Verify caller is a guild member
	var isMember bool
	checkSQL := `SELECT EXISTS(SELECT 1 FROM members WHERE guild_id = $1 AND user_id = $2)`
	if err := s.db.QueryRow(ctx, checkSQL, guildID, userID).Scan(&isMember); err != nil || !isMember {
		return nil, ErrForbidden
	}

	// 3. Lookup user info for name
	var username string
	_ = s.db.QueryRow(ctx, `SELECT username FROM users WHERE id = $1`, userID).Scan(&username)
	if username == "" {
		username = userID.String()
	}

	// 4. Generate LiveKit JWT token
	roomName := fmt.Sprintf("guild_%s_channel_%s", guildID.String(), channelID.String())

	at := auth.NewAccessToken(s.livekitKey, s.livekitSecret)
	grant := &auth.VideoGrant{
		RoomJoin: true,
		Room:     roomName,
	}
	grant.SetCanPublish(true)
	grant.SetCanSubscribe(true)
	grant.SetCanPublishData(true)

	at.AddGrant(grant).
		SetIdentity(userID.String()).
		SetName(username).
		SetValidFor(24 * time.Hour)

	token, err := at.ToJWT()
	if err != nil {
		return nil, fmt.Errorf("generate livekit token: %w", err)
	}

	return &models.VoiceTokenResponse{
		Token:     token,
		URL:       s.livekitURL,
		Room:      roomName,
		ChannelID: channelID.String(),
	}, nil
}

