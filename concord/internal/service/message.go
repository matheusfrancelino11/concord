package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"concord/internal/models"
	"concord/internal/snowflake"
)

// Event constants for real-time fanout
const (
	EventMessageCreate = "MESSAGE_CREATE"
	EventMessageUpdate = "MESSAGE_UPDATE"
	EventMessageDelete = "MESSAGE_DELETE"
	EventTypingStart   = "TYPING_START"
)

var (
	ErrMessageNotFound = errors.New("message not found")
	ErrMessageEmpty    = errors.New("message content cannot be empty")
	ErrMessageTooLong  = errors.New("message content exceeds 2000 characters limit")
	ErrInvalidReply    = errors.New("referenced reply message not found in this channel")
	ErrInvalidLimit    = errors.New("invalid pagination limit")
)

// Broadcaster defines the interface for delivering real-time events to guild Hubs or direct user sessions
type Broadcaster interface {
	BroadcastToGuild(guildID snowflake.ID, eventType string, payload any)
	BroadcastToUser(userID snowflake.ID, eventType string, payload any)
}

// MessageService defines operations for message persistence and fanout
type MessageService interface {
	ListMessages(ctx context.Context, callerID, channelID snowflake.ID, before *snowflake.ID, limit int) ([]models.MessageResponse, error)
	CreateMessage(ctx context.Context, callerID, channelID snowflake.ID, req *models.CreateMessageRequest) (*models.MessageResponse, snowflake.ID, error)
	UpdateMessage(ctx context.Context, callerID, channelID, messageID snowflake.ID, req *models.UpdateMessageRequest) (*models.MessageResponse, snowflake.ID, error)
	DeleteMessage(ctx context.Context, callerID, channelID, messageID snowflake.ID) (snowflake.ID, error)
	TriggerTyping(ctx context.Context, callerID, channelID snowflake.ID) (snowflake.ID, error)
}

type messageService struct {
	db          *pgxpool.Pool
	snowflake   *snowflake.Generator
	broadcaster Broadcaster
}

// NewMessageService constructs a new MessageService
func NewMessageService(db *pgxpool.Pool, sf *snowflake.Generator, broadcaster Broadcaster) MessageService {
	return &messageService{
		db:          db,
		snowflake:   sf,
		broadcaster: broadcaster,
	}
}

// checkChannelAccess verifies that the channel exists, is a valid text/DM channel, and caller has access
func (s *messageService) checkChannelAccess(ctx context.Context, callerID, channelID snowflake.ID) (snowflake.ID, error) {
	var guildID snowflake.ID
	var channelType int

	query := `SELECT COALESCE(guild_id, 0), type FROM channels WHERE id = $1`
	err := s.db.QueryRow(ctx, query, channelID).Scan(&guildID, &channelType)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrChannelNotFound
		}
		return 0, fmt.Errorf("check channel: %w", err)
	}

	if channelType == models.ChannelTypeDM {
		var isRecipient bool
		recipQuery := `SELECT EXISTS(SELECT 1 FROM channel_recipients WHERE channel_id = $1 AND user_id = $2)`
		err = s.db.QueryRow(ctx, recipQuery, channelID, callerID).Scan(&isRecipient)
		if err != nil {
			return 0, fmt.Errorf("check dm recipient: %w", err)
		}
		if !isRecipient {
			return 0, ErrForbidden
		}
		return 0, nil
	}

	if channelType != models.ChannelTypeText {
		return 0, ErrInvalidChannelType
	}

	var isMember bool
	memberQuery := `SELECT EXISTS(SELECT 1 FROM members WHERE guild_id = $1 AND user_id = $2)`
	err = s.db.QueryRow(ctx, memberQuery, guildID, callerID).Scan(&isMember)
	if err != nil {
		return 0, fmt.Errorf("check membership: %w", err)
	}
	if !isMember {
		return 0, ErrForbidden
	}

	return guildID, nil
}

func (s *messageService) getChannelRecipients(ctx context.Context, channelID snowflake.ID) ([]snowflake.ID, error) {
	rows, err := s.db.Query(ctx, `SELECT user_id FROM channel_recipients WHERE channel_id = $1`, channelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var recips []snowflake.ID
	for rows.Next() {
		var uid snowflake.ID
		if err := rows.Scan(&uid); err == nil {
			recips = append(recips, uid)
		}
	}
	return recips, nil
}

func (s *messageService) broadcastEvent(ctx context.Context, guildID, channelID snowflake.ID, eventType string, payload any) {
	if s.broadcaster == nil {
		return
	}
	if guildID != 0 {
		s.broadcaster.BroadcastToGuild(guildID, eventType, payload)
	} else {
		if recips, err := s.getChannelRecipients(ctx, channelID); err == nil {
			for _, uid := range recips {
				s.broadcaster.BroadcastToUser(uid, eventType, payload)
			}
		}
	}
}

func (s *messageService) ListMessages(ctx context.Context, callerID, channelID snowflake.ID, before *snowflake.ID, limit int) ([]models.MessageResponse, error) {
	guildID, err := s.checkChannelAccess(ctx, callerID, channelID)
	if err != nil {
		return nil, err
	}

	if limit <= 0 {
		limit = 50
	} else if limit > 100 {
		limit = 100
	}

	var beforeVal *int64
	if before != nil {
		v := before.Int64()
		beforeVal = &v
	}

	query := `
		SELECT 
			m.id, m.channel_id, m.content, m.type, m.edited_at, m.pinned, m.reply_to_id, m.created_at,
			u.id, u.username, u.global_name, u.avatar
		FROM messages m
		JOIN users u ON u.id = m.author_id
		WHERE m.channel_id = $1 AND ($2::BIGINT IS NULL OR m.id < $2::BIGINT)
		ORDER BY m.id DESC
		LIMIT $3
	`

	rows, err := s.db.Query(ctx, query, channelID, beforeVal, limit)
	if err != nil {
		return nil, fmt.Errorf("query messages: %w", err)
	}
	defer rows.Close()

	messages := make([]models.MessageResponse, 0)
	for rows.Next() {
		var msg models.MessageResponse
		var author models.UserSummary
		if err := rows.Scan(
			&msg.ID,
			&msg.ChannelID,
			&msg.Content,
			&msg.Type,
			&msg.EditedAt,
			&msg.Pinned,
			&msg.ReplyToID,
			&msg.CreatedAt,
			&author.ID,
			&author.Username,
			&author.GlobalName,
			&author.Avatar,
		); err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}
		msg.Author = author
		msg.GuildID = guildID
		messages = append(messages, msg)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate messages: %w", err)
	}

	// Reverse in-place so output is chronological: oldest -> newest
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	return messages, nil
}

func (s *messageService) CreateMessage(ctx context.Context, callerID, channelID snowflake.ID, req *models.CreateMessageRequest) (*models.MessageResponse, snowflake.ID, error) {
	guildID, err := s.checkChannelAccess(ctx, callerID, channelID)
	if err != nil {
		return nil, 0, err
	}

	trimmed := strings.TrimSpace(req.Content)
	if len(trimmed) == 0 {
		return nil, 0, ErrMessageEmpty
	}
	if utf8.RuneCountInString(req.Content) > 2000 {
		return nil, 0, ErrMessageTooLong
	}

	msgType := models.MessageTypeDefault
	var replyIDVal *int64
	if req.ReplyToID != nil {
		var replyExists bool
		replyQuery := `SELECT EXISTS(SELECT 1 FROM messages WHERE id = $1 AND channel_id = $2)`
		err := s.db.QueryRow(ctx, replyQuery, *req.ReplyToID, channelID).Scan(&replyExists)
		if err != nil || !replyExists {
			return nil, 0, ErrInvalidReply
		}
		msgType = models.MessageTypeReply
		v := req.ReplyToID.Int64()
		replyIDVal = &v
	}

	msgID, err := s.snowflake.NextID()
	if err != nil {
		return nil, 0, fmt.Errorf("generate snowflake: %w", err)
	}

	insertQuery := `
		WITH inserted AS (
			INSERT INTO messages (id, channel_id, author_id, content, type, edited_at, pinned, reply_to_id, created_at)
			VALUES ($1, $2, $3, $4, $5, NULL, FALSE, $6, NOW())
			RETURNING id, channel_id, author_id, content, type, edited_at, pinned, reply_to_id, created_at
		)
		SELECT 
			m.id, m.channel_id, m.content, m.type, m.edited_at, m.pinned, m.reply_to_id, m.created_at,
			u.id, u.username, u.global_name, u.avatar
		FROM inserted m
		JOIN users u ON u.id = m.author_id
	`

	var resp models.MessageResponse
	var author models.UserSummary
	err = s.db.QueryRow(ctx, insertQuery, msgID, channelID, callerID, req.Content, msgType, replyIDVal).Scan(
		&resp.ID,
		&resp.ChannelID,
		&resp.Content,
		&resp.Type,
		&resp.EditedAt,
		&resp.Pinned,
		&resp.ReplyToID,
		&resp.CreatedAt,
		&author.ID,
		&author.Username,
		&author.GlobalName,
		&author.Avatar,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("insert message: %w", err)
	}
	resp.Author = author
	resp.GuildID = guildID

	// Broadcast MESSAGE_CREATE to guild or DM recipients
	s.broadcastEvent(ctx, guildID, channelID, EventMessageCreate, resp)

	return &resp, guildID, nil
}

func (s *messageService) UpdateMessage(ctx context.Context, callerID, channelID, messageID snowflake.ID, req *models.UpdateMessageRequest) (*models.MessageResponse, snowflake.ID, error) {
	guildID, err := s.checkChannelAccess(ctx, callerID, channelID)
	if err != nil {
		return nil, 0, err
	}

	trimmed := strings.TrimSpace(req.Content)
	if len(trimmed) == 0 {
		return nil, 0, ErrMessageEmpty
	}
	if utf8.RuneCountInString(req.Content) > 2000 {
		return nil, 0, ErrMessageTooLong
	}

	var authorID snowflake.ID
	authorQuery := `SELECT author_id FROM messages WHERE id = $1 AND channel_id = $2`
	err = s.db.QueryRow(ctx, authorQuery, messageID, channelID).Scan(&authorID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, 0, ErrMessageNotFound
		}
		return nil, 0, fmt.Errorf("lookup message author: %w", err)
	}

	// Strictly restricted to author only
	if authorID != callerID {
		return nil, 0, ErrForbidden
	}

	updateQuery := `
		WITH updated AS (
			UPDATE messages
			SET content = $1, edited_at = NOW()
			WHERE id = $2 AND channel_id = $3
			RETURNING id, channel_id, author_id, content, type, edited_at, pinned, reply_to_id, created_at
		)
		SELECT 
			m.id, m.channel_id, m.content, m.type, m.edited_at, m.pinned, m.reply_to_id, m.created_at,
			u.id, u.username, u.global_name, u.avatar
		FROM updated m
		JOIN users u ON u.id = m.author_id
	`

	var resp models.MessageResponse
	var author models.UserSummary
	err = s.db.QueryRow(ctx, updateQuery, req.Content, messageID, channelID).Scan(
		&resp.ID,
		&resp.ChannelID,
		&resp.Content,
		&resp.Type,
		&resp.EditedAt,
		&resp.Pinned,
		&resp.ReplyToID,
		&resp.CreatedAt,
		&author.ID,
		&author.Username,
		&author.GlobalName,
		&author.Avatar,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("update message: %w", err)
	}
	resp.Author = author
	resp.GuildID = guildID

	// Broadcast MESSAGE_UPDATE to guild or DM recipients
	s.broadcastEvent(ctx, guildID, channelID, EventMessageUpdate, resp)

	return &resp, guildID, nil
}

func (s *messageService) DeleteMessage(ctx context.Context, callerID, channelID, messageID snowflake.ID) (snowflake.ID, error) {
	// First verify channel exists
	var guildID snowflake.ID
	var cType int
	err := s.db.QueryRow(ctx, `SELECT COALESCE(guild_id, 0), type FROM channels WHERE id = $1`, channelID).Scan(&guildID, &cType)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrChannelNotFound
		}
		return 0, fmt.Errorf("query channel: %w", err)
	}

	if cType == models.ChannelTypeDM {
		// DM message: verify caller is author of message
		var authorID snowflake.ID
		err = s.db.QueryRow(ctx, `SELECT author_id FROM messages WHERE id = $1 AND channel_id = $2`, messageID, channelID).Scan(&authorID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return 0, ErrMessageNotFound
			}
			return 0, fmt.Errorf("query dm message delete: %w", err)
		}
		if callerID != authorID {
			return 0, ErrForbidden
		}
	} else {
		// Verify membership
		var isMember bool
		err = s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM members WHERE guild_id = $1 AND user_id = $2)`, guildID, callerID).Scan(&isMember)
		if err != nil || !isMember {
			return 0, ErrForbidden
		}

		// Fetch message author and guild owner
		var authorID, ownerID snowflake.ID
		authQuery := `
			SELECT m.author_id, g.owner_id
			FROM messages m
			JOIN channels c ON c.id = m.channel_id
			JOIN guilds g ON g.id = c.guild_id
			WHERE m.id = $1 AND m.channel_id = $2
		`
		err = s.db.QueryRow(ctx, authQuery, messageID, channelID).Scan(&authorID, &ownerID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return 0, ErrMessageNotFound
			}
			return 0, fmt.Errorf("query message delete auth: %w", err)
		}

		// Author OR guild owner allowed
		if callerID != authorID && callerID != ownerID {
			return 0, ErrForbidden
		}
	}

	delCmd, err := s.db.Exec(ctx, `DELETE FROM messages WHERE id = $1 AND channel_id = $2`, messageID, channelID)
	if err != nil {
		return 0, fmt.Errorf("delete message: %w", err)
	}
	if delCmd.RowsAffected() == 0 {
		return 0, ErrMessageNotFound
	}

	// Broadcast MESSAGE_DELETE to guild or DM recipients
	deletePayload := models.MessageDeletePayload{
		ID:        messageID,
		ChannelID: channelID,
		GuildID:   guildID,
	}
	s.broadcastEvent(ctx, guildID, channelID, EventMessageDelete, deletePayload)

	return guildID, nil
}

func (s *messageService) TriggerTyping(ctx context.Context, callerID, channelID snowflake.ID) (snowflake.ID, error) {
	guildID, err := s.checkChannelAccess(ctx, callerID, channelID)
	if err != nil {
		return 0, err
	}

	// Ephemeral: NO DB WRITE
	typingPayload := models.TypingStartPayload{
		ChannelID: channelID,
		GuildID:   guildID,
		UserID:    callerID,
		Timestamp: time.Now().UnixMilli(),
	}
	s.broadcastEvent(ctx, guildID, channelID, EventTypingStart, typingPayload)

	return guildID, nil
}
