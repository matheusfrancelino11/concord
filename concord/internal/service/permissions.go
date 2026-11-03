package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"concord/internal/models"
	"concord/internal/snowflake"
)

var (
	ErrBanned              = errors.New("user is banned from this server")
	ErrCannotModerateSelf  = errors.New("cannot moderate yourself")
	ErrCannotModerateOwner = errors.New("cannot moderate the server owner")
	ErrHierarchyViolation  = errors.New("target role or user has higher or equal role hierarchy")
	ErrRoleNotFound        = errors.New("role not found")
	ErrCannotDeleteEveryone = errors.New("cannot delete @everyone role")
	ErrCannotDeleteManaged  = errors.New("cannot delete managed role")
)

// PermissionService handles bitwise permission computation and hierarchy checks
type PermissionService interface {
	ComputePermissions(ctx context.Context, guildID, userID snowflake.ID, channelID *snowflake.ID) (int64, error)
	CheckPermission(ctx context.Context, guildID, userID snowflake.ID, channelID *snowflake.ID, requiredPerm int64) error
	GetHighestRolePosition(ctx context.Context, guildID, userID snowflake.ID) (int, bool, error)
	CheckHierarchy(ctx context.Context, guildID, callerID, targetID snowflake.ID) error
	CheckRoleHierarchy(ctx context.Context, guildID, callerID snowflake.ID, targetRolePosition int) error
}

type permissionService struct {
	db *pgxpool.Pool
}

// NewPermissionService creates a new PermissionService instance
func NewPermissionService(db *pgxpool.Pool) PermissionService {
	return &permissionService{db: db}
}

func (s *permissionService) ComputePermissions(
	ctx context.Context,
	guildID, userID snowflake.ID,
	channelID *snowflake.ID,
) (int64, error) {
	// 1. Check if user is the guild owner
	var ownerID snowflake.ID
	err := s.db.QueryRow(ctx, `SELECT owner_id FROM guilds WHERE id = $1`, guildID).Scan(&ownerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrGuildNotFound
		}
		return 0, fmt.Errorf("query guild owner: %w", err)
	}

	// Owner has all permissions (including PermAdministrator)
	if ownerID == userID {
		return ^int64(0), nil
	}

	// Verify membership
	var isMember bool
	checkMemberSQL := `SELECT EXISTS(SELECT 1 FROM members WHERE guild_id = $1 AND user_id = $2)`
	if err := s.db.QueryRow(ctx, checkMemberSQL, guildID, userID).Scan(&isMember); err != nil {
		return 0, fmt.Errorf("check member: %w", err)
	}
	if !isMember {
		return 0, ErrForbidden
	}

	// 2. Base permissions: @everyone role
	var everyoneID snowflake.ID
	var perms int64
	everyoneSQL := `SELECT id, permissions FROM roles WHERE guild_id = $1 AND position = 0 LIMIT 1`
	err = s.db.QueryRow(ctx, everyoneSQL, guildID).Scan(&everyoneID, &perms)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return 0, fmt.Errorf("query @everyone role: %w", err)
	}

	// 3. Member roles: union permissions
	rolesQuery := `
		SELECT r.id, r.permissions
		FROM roles r
		JOIN member_roles mr ON r.id = mr.role_id
		WHERE mr.guild_id = $1 AND mr.user_id = $2
	`
	rows, err := s.db.Query(ctx, rolesQuery, guildID, userID)
	if err != nil {
		return 0, fmt.Errorf("query member roles: %w", err)
	}
	defer rows.Close()

	memberRoleIDs := make(map[snowflake.ID]bool)
	for rows.Next() {
		var roleID snowflake.ID
		var rolePerms int64
		if err := rows.Scan(&roleID, &rolePerms); err != nil {
			return 0, fmt.Errorf("scan role: %w", err)
		}
		memberRoleIDs[roleID] = true
		perms |= rolePerms
	}

	// Administrator grants all permissions across all channels
	if (perms & models.PermAdministrator) != 0 {
		return ^int64(0), nil
	}

	// 4. Channel overwrites (if channelID is specified)
	if channelID != nil {
		type overwrite struct {
			targetID   snowflake.ID
			targetType int // 0 = role, 1 = member
			allow      int64
			deny       int64
		}

		owQuery := `
			SELECT target_id, target_type, allow, deny
			FROM permission_overwrites
			WHERE channel_id = $1
		`
		owRows, err := s.db.Query(ctx, owQuery, *channelID)
		if err != nil {
			return 0, fmt.Errorf("query overwrites: %w", err)
		}
		defer owRows.Close()

		var overwrites []overwrite
		for owRows.Next() {
			var ow overwrite
			if err := owRows.Scan(&ow.targetID, &ow.targetType, &ow.allow, &ow.deny); err != nil {
				return 0, fmt.Errorf("scan overwrite: %w", err)
			}
			overwrites = append(overwrites, ow)
		}

		// (a) Apply @everyone overwrite first
		for _, ow := range overwrites {
			if ow.targetType == 0 && ow.targetID == everyoneID {
				perms = (perms & ^ow.deny) | ow.allow
				break
			}
		}

		// (b) Apply role overwrites (union of allows and denies)
		var roleAllow, roleDeny int64
		for _, ow := range overwrites {
			if ow.targetType == 0 && ow.targetID != everyoneID && memberRoleIDs[ow.targetID] {
				roleAllow |= ow.allow
				roleDeny |= ow.deny
			}
		}
		perms = (perms & ^roleDeny) | roleAllow

		// (c) Apply member-specific overwrite last
		for _, ow := range overwrites {
			if ow.targetType == 1 && ow.targetID == userID {
				perms = (perms & ^ow.deny) | ow.allow
				break
			}
		}
	}

	return perms, nil
}

func (s *permissionService) CheckPermission(
	ctx context.Context,
	guildID, userID snowflake.ID,
	channelID *snowflake.ID,
	requiredPerm int64,
) error {
	perms, err := s.ComputePermissions(ctx, guildID, userID, channelID)
	if err != nil {
		return err
	}

	if (perms & models.PermAdministrator) != 0 {
		return nil
	}

	if (perms & requiredPerm) != requiredPerm {
		return ErrForbidden
	}

	return nil
}

func (s *permissionService) GetHighestRolePosition(
	ctx context.Context,
	guildID, userID snowflake.ID,
) (int, bool, error) {
	var ownerID snowflake.ID
	err := s.db.QueryRow(ctx, `SELECT owner_id FROM guilds WHERE id = $1`, guildID).Scan(&ownerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, false, ErrGuildNotFound
		}
		return 0, false, fmt.Errorf("query guild owner: %w", err)
	}

	if ownerID == userID {
		return 1000000, true, nil
	}

	var maxPos int
	posQuery := `
		SELECT COALESCE(MAX(r.position), 0)
		FROM roles r
		JOIN member_roles mr ON r.id = mr.role_id
		WHERE mr.guild_id = $1 AND mr.user_id = $2
	`
	if err := s.db.QueryRow(ctx, posQuery, guildID, userID).Scan(&maxPos); err != nil {
		return 0, false, fmt.Errorf("query highest role: %w", err)
	}

	return maxPos, false, nil
}

func (s *permissionService) CheckHierarchy(
	ctx context.Context,
	guildID, callerID, targetID snowflake.ID,
) error {
	if callerID == targetID {
		return ErrCannotModerateSelf
	}

	var ownerID snowflake.ID
	err := s.db.QueryRow(ctx, `SELECT owner_id FROM guilds WHERE id = $1`, guildID).Scan(&ownerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrGuildNotFound
		}
		return fmt.Errorf("query guild owner: %w", err)
	}

	if targetID == ownerID {
		return ErrCannotModerateOwner
	}

	if callerID == ownerID {
		return nil // Server owner has absolute hierarchy
	}

	callerPos, _, err := s.GetHighestRolePosition(ctx, guildID, callerID)
	if err != nil {
		return err
	}

	targetPos, _, err := s.GetHighestRolePosition(ctx, guildID, targetID)
	if err != nil {
		return err
	}

	if callerPos <= targetPos {
		return ErrHierarchyViolation
	}

	return nil
}

func (s *permissionService) CheckRoleHierarchy(
	ctx context.Context,
	guildID, callerID snowflake.ID,
	targetRolePosition int,
) error {
	var ownerID snowflake.ID
	err := s.db.QueryRow(ctx, `SELECT owner_id FROM guilds WHERE id = $1`, guildID).Scan(&ownerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrGuildNotFound
		}
		return fmt.Errorf("query guild owner: %w", err)
	}

	if callerID == ownerID {
		return nil
	}

	callerPos, _, err := s.GetHighestRolePosition(ctx, guildID, callerID)
	if err != nil {
		return err
	}

	if callerPos <= targetRolePosition {
		return ErrHierarchyViolation
	}

	return nil
}
