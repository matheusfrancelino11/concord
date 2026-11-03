package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"concord/internal/models"
	"concord/internal/snowflake"
)

var (
	ErrCannotAddSelf        = errors.New("cannot send friend request to yourself")
	ErrAlreadyFriends       = errors.New("you are already friends with this user")
	ErrRequestAlreadySent   = errors.New("friend request has already been sent")
	ErrUserBlocked          = errors.New("cannot perform this action because the user is blocked")
	ErrRelationshipNotFound = errors.New("relationship not found")
)

type UserBroadcaster interface {
	BroadcastToUser(userID snowflake.ID, eventType string, payload any)
}

type RelationshipService interface {
	ListRelationships(ctx context.Context, userID snowflake.ID) ([]models.RelationshipResponse, error)
	SendFriendRequest(ctx context.Context, callerID snowflake.ID, username string) (*models.RelationshipResponse, error)
	AcceptFriendRequest(ctx context.Context, callerID, targetID snowflake.ID) (*models.RelationshipResponse, error)
	RemoveRelationship(ctx context.Context, callerID, targetID snowflake.ID) error
	BlockUser(ctx context.Context, callerID, targetID snowflake.ID) (*models.RelationshipResponse, error)
}

type relationshipService struct {
	db          *pgxpool.Pool
	broadcaster UserBroadcaster
}

func NewRelationshipService(db *pgxpool.Pool, broadcaster UserBroadcaster) RelationshipService {
	return &relationshipService{
		db:          db,
		broadcaster: broadcaster,
	}
}

func (s *relationshipService) ListRelationships(ctx context.Context, userID snowflake.ID) ([]models.RelationshipResponse, error) {
	query := `
		SELECT r.target_id, r.type, u.id, u.username, u.email, u.global_name, u.avatar, u.flags, u.created_at
		FROM relationships r
		JOIN users u ON r.target_id = u.id
		WHERE r.user_id = $1
		ORDER BY LOWER(u.username) ASC;`

	rows, err := s.db.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("query relationships: %w", err)
	}
	defer rows.Close()

	var result []models.RelationshipResponse
	for rows.Next() {
		var rel models.RelationshipResponse
		if err := rows.Scan(
			&rel.ID,
			&rel.Type,
			&rel.User.ID,
			&rel.User.Username,
			&rel.User.Email,
			&rel.User.GlobalName,
			&rel.User.Avatar,
			&rel.User.Flags,
			&rel.User.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan relationship: %w", err)
		}
		result = append(result, rel)
	}

	if result == nil {
		result = make([]models.RelationshipResponse, 0)
	}
	return result, nil
}

func (s *relationshipService) SendFriendRequest(ctx context.Context, callerID snowflake.ID, username string) (*models.RelationshipResponse, error) {
	trimmed := strings.TrimSpace(username)
	if trimmed == "" {
		return nil, errors.New("username is required")
	}

	// 1. Lookup target user by username (case-insensitive)
	targetSQL := `SELECT id, username, email, global_name, avatar, flags, created_at FROM users WHERE LOWER(username) = LOWER($1)`
	var target models.UserResponse
	err := s.db.QueryRow(ctx, targetSQL, trimmed).Scan(
		&target.ID,
		&target.Username,
		&target.Email,
		&target.GlobalName,
		&target.Avatar,
		&target.Flags,
		&target.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("usuário não encontrado")
		}
		return nil, fmt.Errorf("lookup user: %w", err)
	}

	if target.ID == callerID {
		return nil, ErrCannotAddSelf
	}

	// 2. Fetch caller info for gateway dispatch
	callerSQL := `SELECT id, username, email, global_name, avatar, flags, created_at FROM users WHERE id = $1`
	var caller models.UserResponse
	if err := s.db.QueryRow(ctx, callerSQL, callerID).Scan(
		&caller.ID,
		&caller.Username,
		&caller.Email,
		&caller.GlobalName,
		&caller.Avatar,
		&caller.Flags,
		&caller.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("lookup caller: %w", err)
	}

	// 3. Check existing relationship
	var existingType int
	err = s.db.QueryRow(ctx, `SELECT type FROM relationships WHERE user_id = $1 AND target_id = $2`, callerID, target.ID).Scan(&existingType)
	if err == nil {
		switch existingType {
		case models.RelationshipTypeFriend:
			return nil, ErrAlreadyFriends
		case models.RelationshipTypeOutgoing:
			return nil, ErrRequestAlreadySent
		case models.RelationshipTypeBlocked:
			return nil, errors.New("você bloqueou este usuário, desbloqueie-o antes de enviar solicitação")
		case models.RelationshipTypeIncoming:
			// Mutual accept: Target already sent request to Caller!
			return s.AcceptFriendRequest(ctx, callerID, target.ID)
		}
	}

	// 4. Create pending friend request in transaction
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Caller gets type 4 (Outgoing)
	insertCaller := `
		INSERT INTO relationships (user_id, target_id, type)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, target_id) DO UPDATE SET type = EXCLUDED.type;`
	if _, err := tx.Exec(ctx, insertCaller, callerID, target.ID, models.RelationshipTypeOutgoing); err != nil {
		return nil, fmt.Errorf("insert caller relationship: %w", err)
	}

	// Target gets type 3 (Incoming)
	insertTarget := `
		INSERT INTO relationships (user_id, target_id, type)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, target_id) DO UPDATE SET type = EXCLUDED.type;`
	if _, err := tx.Exec(ctx, insertTarget, target.ID, callerID, models.RelationshipTypeIncoming); err != nil {
		return nil, fmt.Errorf("insert target relationship: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	// 5. Gateway Dispatch
	callerRel := models.RelationshipResponse{
		ID:   target.ID,
		Type: models.RelationshipTypeOutgoing,
		User: target,
	}
	targetRel := models.RelationshipResponse{
		ID:   callerID,
		Type: models.RelationshipTypeIncoming,
		User: caller,
	}

	if s.broadcaster != nil {
		s.broadcaster.BroadcastToUser(callerID, "RELATIONSHIP_ADD", callerRel)
		s.broadcaster.BroadcastToUser(target.ID, "RELATIONSHIP_ADD", targetRel)
	}

	return &callerRel, nil
}

func (s *relationshipService) AcceptFriendRequest(ctx context.Context, callerID, targetID snowflake.ID) (*models.RelationshipResponse, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Promote caller and target to friends (type 1)
	upsertSQL := `
		INSERT INTO relationships (user_id, target_id, type)
		VALUES ($1, $2, 1)
		ON CONFLICT (user_id, target_id) DO UPDATE SET type = 1;`

	if _, err := tx.Exec(ctx, upsertSQL, callerID, targetID); err != nil {
		return nil, fmt.Errorf("upsert caller friend: %w", err)
	}
	if _, err := tx.Exec(ctx, upsertSQL, targetID, callerID); err != nil {
		return nil, fmt.Errorf("upsert target friend: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	// Fetch target and caller info
	var target models.UserResponse
	_ = s.db.QueryRow(ctx, `SELECT id, username, email, global_name, avatar, flags, created_at FROM users WHERE id = $1`, targetID).Scan(
		&target.ID, &target.Username, &target.Email, &target.GlobalName, &target.Avatar, &target.Flags, &target.CreatedAt,
	)

	var caller models.UserResponse
	_ = s.db.QueryRow(ctx, `SELECT id, username, email, global_name, avatar, flags, created_at FROM users WHERE id = $1`, callerID).Scan(
		&caller.ID, &caller.Username, &caller.Email, &caller.GlobalName, &caller.Avatar, &caller.Flags, &caller.CreatedAt,
	)

	callerRel := models.RelationshipResponse{
		ID:   targetID,
		Type: models.RelationshipTypeFriend,
		User: target,
	}
	targetRel := models.RelationshipResponse{
		ID:   callerID,
		Type: models.RelationshipTypeFriend,
		User: caller,
	}

	if s.broadcaster != nil {
		s.broadcaster.BroadcastToUser(callerID, "RELATIONSHIP_UPDATE", callerRel)
		s.broadcaster.BroadcastToUser(targetID, "RELATIONSHIP_UPDATE", targetRel)
	}

	return &callerRel, nil
}

func (s *relationshipService) RemoveRelationship(ctx context.Context, callerID, targetID snowflake.ID) error {
	// If caller has blocked target, only delete caller's block record
	var relType int
	err := s.db.QueryRow(ctx, `SELECT type FROM relationships WHERE user_id = $1 AND target_id = $2`, callerID, targetID).Scan(&relType)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("query rel: %w", err)
	}

	if relType == models.RelationshipTypeBlocked {
		_, _ = s.db.Exec(ctx, `DELETE FROM relationships WHERE user_id = $1 AND target_id = $2`, callerID, targetID)
	} else {
		// Mutual removal
		_, _ = s.db.Exec(ctx, `DELETE FROM relationships WHERE (user_id = $1 AND target_id = $2) OR (user_id = $2 AND target_id = $1)`, callerID, targetID)
	}

	if s.broadcaster != nil {
		s.broadcaster.BroadcastToUser(callerID, "RELATIONSHIP_REMOVE", map[string]string{"id": targetID.String()})
		s.broadcaster.BroadcastToUser(targetID, "RELATIONSHIP_REMOVE", map[string]string{"id": callerID.String()})
	}

	return nil
}

func (s *relationshipService) BlockUser(ctx context.Context, callerID, targetID snowflake.ID) (*models.RelationshipResponse, error) {
	if callerID == targetID {
		return nil, errors.New("cannot block yourself")
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Remove target's side of relationship if any
	_, _ = tx.Exec(ctx, `DELETE FROM relationships WHERE user_id = $1 AND target_id = $2`, targetID, callerID)

	// Upsert caller's block
	upsertBlock := `
		INSERT INTO relationships (user_id, target_id, type)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, target_id) DO UPDATE SET type = EXCLUDED.type;`
	if _, err := tx.Exec(ctx, upsertBlock, callerID, targetID, models.RelationshipTypeBlocked); err != nil {
		return nil, fmt.Errorf("upsert block: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	var target models.UserResponse
	_ = s.db.QueryRow(ctx, `SELECT id, username, email, global_name, avatar, flags, created_at FROM users WHERE id = $1`, targetID).Scan(
		&target.ID, &target.Username, &target.Email, &target.GlobalName, &target.Avatar, &target.Flags, &target.CreatedAt,
	)

	rel := models.RelationshipResponse{
		ID:   targetID,
		Type: models.RelationshipTypeBlocked,
		User: target,
	}

	if s.broadcaster != nil {
		s.broadcaster.BroadcastToUser(callerID, "RELATIONSHIP_ADD", rel)
		s.broadcaster.BroadcastToUser(targetID, "RELATIONSHIP_REMOVE", map[string]string{"id": callerID.String()})
	}

	return &rel, nil
}
