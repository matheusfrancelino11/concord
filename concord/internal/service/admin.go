package service

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"concord/internal/models"
	"concord/internal/snowflake"
)

var (
	ErrRoleNameRequired = errors.New("role name cannot be empty")
	ErrMemberNotFound   = errors.New("member not found")
)

// AdminService defines server administration and role management operations
type AdminService interface {
	// Server Management
	UpdateGuild(ctx context.Context, callerID, guildID snowflake.ID, req *models.UpdateGuildRequest) (*models.GuildDetailResponse, error)

	// Role Management
	ListRoles(ctx context.Context, callerID, guildID snowflake.ID) ([]models.RoleResponse, error)
	CreateRole(ctx context.Context, callerID, guildID snowflake.ID, req *models.CreateRoleRequest) (*models.RoleResponse, error)
	UpdateRole(ctx context.Context, callerID, guildID, roleID snowflake.ID, req *models.UpdateRoleRequest) (*models.RoleResponse, error)
	DeleteRole(ctx context.Context, callerID, guildID, roleID snowflake.ID) error

	// Member Roles & Moderation
	AddMemberRole(ctx context.Context, callerID, guildID, userID, roleID snowflake.ID) error
	RemoveMemberRole(ctx context.Context, callerID, guildID, userID, roleID snowflake.ID) error
	UpdateMember(ctx context.Context, callerID, guildID, userID snowflake.ID, req *models.UpdateMemberRequest) (*models.MemberResponse, error)
	KickMember(ctx context.Context, callerID, guildID, userID snowflake.ID) error

	// Bans
	ListBans(ctx context.Context, callerID, guildID snowflake.ID) ([]models.BanResponse, error)
	BanMember(ctx context.Context, callerID, guildID, userID snowflake.ID, req *models.CreateBanRequest) error
	UnbanMember(ctx context.Context, callerID, guildID, userID snowflake.ID) error

	// Channel Overwrites
	SetChannelOverwrite(ctx context.Context, callerID, channelID, targetID snowflake.ID, req *models.SetPermissionOverwriteRequest) error
	DeleteChannelOverwrite(ctx context.Context, callerID, channelID, targetID snowflake.ID) error
}

type adminService struct {
	db           *pgxpool.Pool
	snowflake    *snowflake.Generator
	permService  PermissionService
	guildService GuildService
}

// NewAdminService creates a new AdminService instance
func NewAdminService(
	db *pgxpool.Pool,
	sf *snowflake.Generator,
	permService PermissionService,
	guildService GuildService,
) AdminService {
	return &adminService{
		db:           db,
		snowflake:    sf,
		permService:  permService,
		guildService: guildService,
	}
}

// UpdateGuild modifies server name or icon
func (s *adminService) UpdateGuild(
	ctx context.Context,
	callerID, guildID snowflake.ID,
	req *models.UpdateGuildRequest,
) (*models.GuildDetailResponse, error) {
	if err := s.permService.CheckPermission(ctx, guildID, callerID, nil, models.PermManageGuild); err != nil {
		return nil, err
	}

	if req.Name != nil {
		trimmed := strings.TrimSpace(*req.Name)
		if len(trimmed) < 2 || len(trimmed) > 100 {
			return nil, ErrInvalidGuildName
		}
		*req.Name = trimmed
	}

	var name string
	var icon *string
	err := s.db.QueryRow(ctx, `SELECT name, icon FROM guilds WHERE id = $1`, guildID).Scan(&name, &icon)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrGuildNotFound
		}
		return nil, fmt.Errorf("query guild: %w", err)
	}

	if req.Name != nil {
		name = *req.Name
	}
	if req.Icon != nil {
		icon = req.Icon
	}

	updateSQL := `UPDATE guilds SET name = $1, icon = $2 WHERE id = $3`
	if _, err := s.db.Exec(ctx, updateSQL, name, icon, guildID); err != nil {
		return nil, fmt.Errorf("update guild: %w", err)
	}

	return s.guildService.GetGuildDetails(ctx, callerID, guildID)
}

// ListRoles retrieves all roles configured for a guild
func (s *adminService) ListRoles(ctx context.Context, callerID, guildID snowflake.ID) ([]models.RoleResponse, error) {
	// Verify caller is member
	var isMember bool
	checkSQL := `SELECT EXISTS(SELECT 1 FROM members WHERE guild_id = $1 AND user_id = $2)`
	if err := s.db.QueryRow(ctx, checkSQL, guildID, callerID).Scan(&isMember); err != nil {
		return nil, fmt.Errorf("check member: %w", err)
	}
	if !isMember {
		return nil, ErrForbidden
	}

	query := `
		SELECT id, guild_id, name, permissions, position, color, hoist, mentionable, managed
		FROM roles
		WHERE guild_id = $1
		ORDER BY position ASC, id ASC
	`
	rows, err := s.db.Query(ctx, query, guildID)
	if err != nil {
		return nil, fmt.Errorf("query roles: %w", err)
	}
	defer rows.Close()

	roles := make([]models.RoleResponse, 0)
	for rows.Next() {
		var r models.Role
		if err := rows.Scan(
			&r.ID,
			&r.GuildID,
			&r.Name,
			&r.Permissions,
			&r.Position,
			&r.Color,
			&r.Hoist,
			&r.Mentionable,
			&r.Managed,
		); err != nil {
			return nil, fmt.Errorf("scan role: %w", err)
		}
		roles = append(roles, models.RoleResponse{
			ID:          r.ID,
			GuildID:     r.GuildID,
			Name:        r.Name,
			Permissions: strconv.FormatInt(r.Permissions, 10),
			Position:    r.Position,
			Color:       r.Color,
			Hoist:       r.Hoist,
			Mentionable: r.Mentionable,
			Managed:     r.Managed,
		})
	}

	return roles, nil
}

// CreateRole creates a new custom role with permissions
func (s *adminService) CreateRole(
	ctx context.Context,
	callerID, guildID snowflake.ID,
	req *models.CreateRoleRequest,
) (*models.RoleResponse, error) {
	if err := s.permService.CheckPermission(ctx, guildID, callerID, nil, models.PermManageRoles); err != nil {
		return nil, err
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "new role"
	}

	var permissions int64
	if req.Permissions != nil && *req.Permissions != "" {
		p, err := strconv.ParseInt(*req.Permissions, 10, 64)
		if err == nil {
			permissions = p
		}
	}

	color := 0
	if req.Color != nil {
		color = *req.Color
	}
	hoist := false
	if req.Hoist != nil {
		hoist = *req.Hoist
	}
	mentionable := false
	if req.Mentionable != nil {
		mentionable = *req.Mentionable
	}

	// Calculate next position (max position + 1)
	var maxPos int
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(MAX(position), 0) FROM roles WHERE guild_id = $1`, guildID).Scan(&maxPos)
	newPosition := maxPos + 1

	roleID, err := s.snowflake.NextID()
	if err != nil {
		return nil, fmt.Errorf("generate role id: %w", err)
	}

	insertSQL := `
		INSERT INTO roles (id, guild_id, name, permissions, position, color, hoist, mentionable, managed)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE)
		RETURNING id, guild_id, name, permissions, position, color, hoist, mentionable, managed
	`
	var r models.Role
	err = s.db.QueryRow(ctx, insertSQL, roleID, guildID, name, permissions, newPosition, color, hoist, mentionable).Scan(
		&r.ID,
		&r.GuildID,
		&r.Name,
		&r.Permissions,
		&r.Position,
		&r.Color,
		&r.Hoist,
		&r.Mentionable,
		&r.Managed,
	)
	if err != nil {
		return nil, fmt.Errorf("insert role: %w", err)
	}

	return &models.RoleResponse{
		ID:          r.ID,
		GuildID:     r.GuildID,
		Name:        r.Name,
		Permissions: strconv.FormatInt(r.Permissions, 10),
		Position:    r.Position,
		Color:       r.Color,
		Hoist:       r.Hoist,
		Mentionable: r.Mentionable,
		Managed:     r.Managed,
	}, nil
}

// UpdateRole modifies role attributes and checks role hierarchy
func (s *adminService) UpdateRole(
	ctx context.Context,
	callerID, guildID, roleID snowflake.ID,
	req *models.UpdateRoleRequest,
) (*models.RoleResponse, error) {
	if err := s.permService.CheckPermission(ctx, guildID, callerID, nil, models.PermManageRoles); err != nil {
		return nil, err
	}

	var current models.Role
	selectSQL := `
		SELECT id, guild_id, name, permissions, position, color, hoist, mentionable, managed
		FROM roles
		WHERE id = $1 AND guild_id = $2
	`
	err := s.db.QueryRow(ctx, selectSQL, roleID, guildID).Scan(
		&current.ID,
		&current.GuildID,
		&current.Name,
		&current.Permissions,
		&current.Position,
		&current.Color,
		&current.Hoist,
		&current.Mentionable,
		&current.Managed,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRoleNotFound
		}
		return nil, fmt.Errorf("query role: %w", err)
	}

	// Hierarchy check: caller must have higher role than target role (unless owner)
	if err := s.permService.CheckRoleHierarchy(ctx, guildID, callerID, current.Position); err != nil {
		return nil, err
	}

	// @everyone cannot be renamed or moved
	isEveryone := current.Position == 0 || current.Name == "@everyone"
	if isEveryone {
		if req.Name != nil && *req.Name != "@everyone" {
			return nil, errors.New("cannot rename @everyone role")
		}
		if req.Position != nil && *req.Position != 0 {
			return nil, errors.New("cannot modify @everyone position")
		}
	}

	if req.Position != nil && *req.Position != current.Position {
		// Cannot move above or equal to caller's highest position
		if err := s.permService.CheckRoleHierarchy(ctx, guildID, callerID, *req.Position); err != nil {
			return nil, err
		}
		current.Position = *req.Position
	}

	if req.Name != nil {
		name := strings.TrimSpace(*req.Name)
		if name == "" {
			return nil, ErrRoleNameRequired
		}
		current.Name = name
	}
	if req.Permissions != nil && *req.Permissions != "" {
		p, err := strconv.ParseInt(*req.Permissions, 10, 64)
		if err == nil {
			current.Permissions = p
		}
	}
	if req.Color != nil {
		current.Color = *req.Color
	}
	if req.Hoist != nil {
		current.Hoist = *req.Hoist
	}
	if req.Mentionable != nil {
		current.Mentionable = *req.Mentionable
	}

	updateSQL := `
		UPDATE roles
		SET name = $1, permissions = $2, position = $3, color = $4, hoist = $5, mentionable = $6
		WHERE id = $7 AND guild_id = $8
	`
	if _, err := s.db.Exec(ctx, updateSQL, current.Name, current.Permissions, current.Position, current.Color, current.Hoist, current.Mentionable, roleID, guildID); err != nil {
		return nil, fmt.Errorf("update role: %w", err)
	}

	return &models.RoleResponse{
		ID:          current.ID,
		GuildID:     current.GuildID,
		Name:        current.Name,
		Permissions: strconv.FormatInt(current.Permissions, 10),
		Position:    current.Position,
		Color:       current.Color,
		Hoist:       current.Hoist,
		Mentionable: current.Mentionable,
		Managed:     current.Managed,
	}, nil
}

// DeleteRole removes a custom role from the guild
func (s *adminService) DeleteRole(ctx context.Context, callerID, guildID, roleID snowflake.ID) error {
	if err := s.permService.CheckPermission(ctx, guildID, callerID, nil, models.PermManageRoles); err != nil {
		return err
	}

	var position int
	var managed bool
	var name string
	selectSQL := `SELECT position, managed, name FROM roles WHERE id = $1 AND guild_id = $2`
	err := s.db.QueryRow(ctx, selectSQL, roleID, guildID).Scan(&position, &managed, &name)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrRoleNotFound
		}
		return fmt.Errorf("query role: %w", err)
	}

	if position == 0 || name == "@everyone" {
		return ErrCannotDeleteEveryone
	}
	if managed {
		return ErrCannotDeleteManaged
	}

	if err := s.permService.CheckRoleHierarchy(ctx, guildID, callerID, position); err != nil {
		return err
	}

	deleteSQL := `DELETE FROM roles WHERE id = $1 AND guild_id = $2`
	if _, err := s.db.Exec(ctx, deleteSQL, roleID, guildID); err != nil {
		return fmt.Errorf("delete role: %w", err)
	}

	return nil
}

// AddMemberRole assigns a role to a guild member
func (s *adminService) AddMemberRole(
	ctx context.Context,
	callerID, guildID, userID, roleID snowflake.ID,
) error {
	if err := s.permService.CheckPermission(ctx, guildID, callerID, nil, models.PermManageRoles); err != nil {
		return err
	}

	var rolePos int
	roleSQL := `SELECT position FROM roles WHERE id = $1 AND guild_id = $2`
	if err := s.db.QueryRow(ctx, roleSQL, roleID, guildID).Scan(&rolePos); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrRoleNotFound
		}
		return fmt.Errorf("query role: %w", err)
	}

	if err := s.permService.CheckRoleHierarchy(ctx, guildID, callerID, rolePos); err != nil {
		return err
	}

	insertSQL := `
		INSERT INTO member_roles (guild_id, user_id, role_id)
		VALUES ($1, $2, $3)
		ON CONFLICT DO NOTHING
	`
	if _, err := s.db.Exec(ctx, insertSQL, guildID, userID, roleID); err != nil {
		return fmt.Errorf("add member role: %w", err)
	}

	return nil
}

// RemoveMemberRole detaches a role from a guild member
func (s *adminService) RemoveMemberRole(
	ctx context.Context,
	callerID, guildID, userID, roleID snowflake.ID,
) error {
	if err := s.permService.CheckPermission(ctx, guildID, callerID, nil, models.PermManageRoles); err != nil {
		return err
	}

	var rolePos int
	var name string
	roleSQL := `SELECT position, name FROM roles WHERE id = $1 AND guild_id = $2`
	if err := s.db.QueryRow(ctx, roleSQL, roleID, guildID).Scan(&rolePos, &name); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrRoleNotFound
		}
		return fmt.Errorf("query role: %w", err)
	}

	if rolePos == 0 || name == "@everyone" {
		return errors.New("cannot remove @everyone role from a member")
	}

	if err := s.permService.CheckRoleHierarchy(ctx, guildID, callerID, rolePos); err != nil {
		return err
	}

	deleteSQL := `DELETE FROM member_roles WHERE guild_id = $1 AND user_id = $2 AND role_id = $3`
	if _, err := s.db.Exec(ctx, deleteSQL, guildID, userID, roleID); err != nil {
		return fmt.Errorf("remove member role: %w", err)
	}

	return nil
}

// UpdateMember updates member nick, mute, deaf, and roles
func (s *adminService) UpdateMember(
	ctx context.Context,
	callerID, guildID, userID snowflake.ID,
	req *models.UpdateMemberRequest,
) (*models.MemberResponse, error) {
	// Moderation permission checks
	if req.Nick != nil && callerID != userID {
		if err := s.permService.CheckPermission(ctx, guildID, callerID, nil, models.PermManageGuild); err != nil {
			return nil, err
		}
		if err := s.permService.CheckHierarchy(ctx, guildID, callerID, userID); err != nil {
			return nil, err
		}
	}
	if req.Mute != nil {
		if err := s.permService.CheckPermission(ctx, guildID, callerID, nil, models.PermMuteMembers); err != nil {
			return nil, err
		}
	}
	if req.Deaf != nil {
		if err := s.permService.CheckPermission(ctx, guildID, callerID, nil, models.PermDeafenMembers); err != nil {
			return nil, err
		}
	}
	if req.Roles != nil {
		if err := s.permService.CheckPermission(ctx, guildID, callerID, nil, models.PermManageRoles); err != nil {
			return nil, err
		}
		if callerID != userID {
			if err := s.permService.CheckHierarchy(ctx, guildID, callerID, userID); err != nil {
				return nil, err
			}
		}
	}

	// Update nick/mute/deaf in members table
	var current models.Member
	memberSQL := `SELECT guild_id, user_id, nick, joined_at, deaf, mute, flags FROM members WHERE guild_id = $1 AND user_id = $2`
	err := s.db.QueryRow(ctx, memberSQL, guildID, userID).Scan(
		&current.GuildID,
		&current.UserID,
		&current.Nick,
		&current.JoinedAt,
		&current.Deaf,
		&current.Mute,
		&current.Flags,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrMemberNotFound
		}
		return nil, fmt.Errorf("query member: %w", err)
	}

	if req.Nick != nil {
		trimmed := strings.TrimSpace(*req.Nick)
		if trimmed == "" {
			current.Nick = nil
		} else {
			current.Nick = &trimmed
		}
	}
	if req.Mute != nil {
		current.Mute = *req.Mute
	}
	if req.Deaf != nil {
		current.Deaf = *req.Deaf
	}

	updateMemberSQL := `UPDATE members SET nick = $1, mute = $2, deaf = $3 WHERE guild_id = $4 AND user_id = $5`
	if _, err := s.db.Exec(ctx, updateMemberSQL, current.Nick, current.Mute, current.Deaf, guildID, userID); err != nil {
		return nil, fmt.Errorf("update member: %w", err)
	}

	// If roles provided, sync member_roles
	if req.Roles != nil {
		// Retain @everyone role
		var everyoneRoleID snowflake.ID
		_ = s.db.QueryRow(ctx, `SELECT id FROM roles WHERE guild_id = $1 AND position = 0 LIMIT 1`, guildID).Scan(&everyoneRoleID)

		// Delete existing roles except @everyone
		_, _ = s.db.Exec(ctx, `DELETE FROM member_roles WHERE guild_id = $1 AND user_id = $2 AND role_id != $3`, guildID, userID, everyoneRoleID)

		for _, rID := range *req.Roles {
			if rID != everyoneRoleID {
				_, _ = s.db.Exec(ctx, `INSERT INTO member_roles (guild_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, guildID, userID, rID)
			}
		}
	}

	// Fetch updated user info
	var u models.UserSummary
	_ = s.db.QueryRow(ctx, `SELECT id, username, global_name, avatar FROM users WHERE id = $1`, userID).Scan(
		&u.ID,
		&u.Username,
		&u.GlobalName,
		&u.Avatar,
	)

	// Fetch updated roles
	roleIDs := make([]snowflake.ID, 0)
	rRows, err := s.db.Query(ctx, `SELECT role_id FROM member_roles WHERE guild_id = $1 AND user_id = $2`, guildID, userID)
	if err == nil {
		defer rRows.Close()
		for rRows.Next() {
			var rID snowflake.ID
			if err := rRows.Scan(&rID); err == nil {
				roleIDs = append(roleIDs, rID)
			}
		}
	}

	return &models.MemberResponse{
		GuildID:  guildID,
		UserID:   userID,
		Nick:     current.Nick,
		Roles:    roleIDs,
		JoinedAt: current.JoinedAt,
		Deaf:     current.Deaf,
		Mute:     current.Mute,
		Flags:    current.Flags,
		User:     u,
	}, nil
}

// KickMember ejects a member from the guild
func (s *adminService) KickMember(ctx context.Context, callerID, guildID, userID snowflake.ID) error {
	if err := s.permService.CheckPermission(ctx, guildID, callerID, nil, models.PermKickMembers); err != nil {
		return err
	}

	if err := s.permService.CheckHierarchy(ctx, guildID, callerID, userID); err != nil {
		return err
	}

	deleteSQL := `DELETE FROM members WHERE guild_id = $1 AND user_id = $2`
	res, err := s.db.Exec(ctx, deleteSQL, guildID, userID)
	if err != nil {
		return fmt.Errorf("delete member: %w", err)
	}

	if res.RowsAffected() == 0 {
		return ErrMemberNotFound
	}

	return nil
}

// BanMember bans a user and removes them from the guild
func (s *adminService) BanMember(
	ctx context.Context,
	callerID, guildID, userID snowflake.ID,
	req *models.CreateBanRequest,
) error {
	if err := s.permService.CheckPermission(ctx, guildID, callerID, nil, models.PermBanMembers); err != nil {
		return err
	}

	if err := s.permService.CheckHierarchy(ctx, guildID, callerID, userID); err != nil {
		return err
	}

	var reason *string
	if req != nil && req.Reason != nil {
		r := strings.TrimSpace(*req.Reason)
		if r != "" {
			reason = &r
		}
	}

	// Insert into bans
	insertBanSQL := `
		INSERT INTO bans (guild_id, user_id, reason, created_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (guild_id, user_id) DO UPDATE SET reason = EXCLUDED.reason, created_at = EXCLUDED.created_at
	`
	if _, err := s.db.Exec(ctx, insertBanSQL, guildID, userID, reason); err != nil {
		return fmt.Errorf("insert ban: %w", err)
	}

	// Delete message history if requested
	if req != nil && req.DeleteMessageDays != nil && *req.DeleteMessageDays > 0 {
		days := *req.DeleteMessageDays
		deleteMsgSQL := `
			DELETE FROM messages
			WHERE author_id = $1
			  AND channel_id IN (SELECT id FROM channels WHERE guild_id = $2)
			  AND created_at >= NOW() - ($3 || ' days')::INTERVAL
		`
		_, _ = s.db.Exec(ctx, deleteMsgSQL, userID, guildID, days)
	}

	// Delete from members table (cascades to member_roles and voice_states)
	_, _ = s.db.Exec(ctx, `DELETE FROM members WHERE guild_id = $1 AND user_id = $2`, guildID, userID)

	return nil
}

// UnbanMember revokes a server ban
func (s *adminService) UnbanMember(ctx context.Context, callerID, guildID, userID snowflake.ID) error {
	if err := s.permService.CheckPermission(ctx, guildID, callerID, nil, models.PermBanMembers); err != nil {
		return err
	}

	deleteSQL := `DELETE FROM bans WHERE guild_id = $1 AND user_id = $2`
	res, err := s.db.Exec(ctx, deleteSQL, guildID, userID)
	if err != nil {
		return fmt.Errorf("delete ban: %w", err)
	}

	if res.RowsAffected() == 0 {
		return errors.New("ban not found")
	}

	return nil
}

// ListBans returns all bans registered for a guild
func (s *adminService) ListBans(ctx context.Context, callerID, guildID snowflake.ID) ([]models.BanResponse, error) {
	if err := s.permService.CheckPermission(ctx, guildID, callerID, nil, models.PermBanMembers); err != nil {
		return nil, err
	}

	query := `
		SELECT b.reason, b.created_at, u.id, u.username, u.global_name, u.avatar
		FROM bans b
		JOIN users u ON b.user_id = u.id
		WHERE b.guild_id = $1
		ORDER BY b.created_at DESC
	`
	rows, err := s.db.Query(ctx, query, guildID)
	if err != nil {
		return nil, fmt.Errorf("query bans: %w", err)
	}
	defer rows.Close()

	bans := make([]models.BanResponse, 0)
	for rows.Next() {
		var b models.BanResponse
		var reason *string
		var createdAt time.Time
		if err := rows.Scan(
			&reason,
			&createdAt,
			&b.User.ID,
			&b.User.Username,
			&b.User.GlobalName,
			&b.User.Avatar,
		); err != nil {
			return nil, fmt.Errorf("scan ban: %w", err)
		}
		b.Reason = reason
		b.CreatedAt = createdAt
		bans = append(bans, b)
	}

	return bans, nil
}

// SetChannelOverwrite creates or updates permission overwrites on a channel
func (s *adminService) SetChannelOverwrite(
	ctx context.Context,
	callerID, channelID, targetID snowflake.ID,
	req *models.SetPermissionOverwriteRequest,
) error {
	var guildID snowflake.ID
	err := s.db.QueryRow(ctx, `SELECT guild_id FROM channels WHERE id = $1`, channelID).Scan(&guildID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrChannelNotFound
		}
		return fmt.Errorf("query channel guild: %w", err)
	}

	if err := s.permService.CheckPermission(ctx, guildID, callerID, &channelID, models.PermManageChannels); err != nil {
		return err
	}

	var allow int64
	if req.Allow != nil && *req.Allow != "" {
		a, err := strconv.ParseInt(*req.Allow, 10, 64)
		if err == nil {
			allow = a
		}
	}

	var deny int64
	if req.Deny != nil && *req.Deny != "" {
		d, err := strconv.ParseInt(*req.Deny, 10, 64)
		if err == nil {
			deny = d
		}
	}

	upsertSQL := `
		INSERT INTO permission_overwrites (channel_id, target_id, target_type, allow, deny)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (channel_id, target_id, target_type)
		DO UPDATE SET allow = EXCLUDED.allow, deny = EXCLUDED.deny
	`
	if _, err := s.db.Exec(ctx, upsertSQL, channelID, targetID, req.TargetType, allow, deny); err != nil {
		return fmt.Errorf("upsert overwrite: %w", err)
	}

	return nil
}

// DeleteChannelOverwrite removes a permission overwrite from a channel
func (s *adminService) DeleteChannelOverwrite(
	ctx context.Context,
	callerID, channelID, targetID snowflake.ID,
) error {
	var guildID snowflake.ID
	err := s.db.QueryRow(ctx, `SELECT guild_id FROM channels WHERE id = $1`, channelID).Scan(&guildID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrChannelNotFound
		}
		return fmt.Errorf("query channel guild: %w", err)
	}

	if err := s.permService.CheckPermission(ctx, guildID, callerID, &channelID, models.PermManageChannels); err != nil {
		return err
	}

	deleteSQL := `DELETE FROM permission_overwrites WHERE channel_id = $1 AND target_id = $2`
	if _, err := s.db.Exec(ctx, deleteSQL, channelID, targetID); err != nil {
		return fmt.Errorf("delete overwrite: %w", err)
	}

	return nil
}
