package service

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"concord/internal/models"
	"concord/internal/snowflake"
)

var (
	ErrInviteNotFound = errors.New("invite not found or expired")
	ErrAlreadyMember  = errors.New("user is already a member of this server")
)

// InviteService handles creation, lookup, and redemption of server invites
type InviteService interface {
	CreateInvite(ctx context.Context, callerID snowflake.ID, guildID snowflake.ID, req *models.CreateInviteRequest) (*models.Invite, error)
	GetInvite(ctx context.Context, code string) (*models.InviteResponse, error)
	UseInvite(ctx context.Context, callerID snowflake.ID, code string) (*models.GuildDetailResponse, *models.MemberResponse, error)
	ListMembers(ctx context.Context, callerID snowflake.ID, guildID snowflake.ID) ([]models.MemberResponse, error)
}

type inviteService struct {
	db           *pgxpool.Pool
	guildService GuildService
}

// NewInviteService constructs a new InviteService
func NewInviteService(db *pgxpool.Pool, guildService GuildService) InviteService {
	return &inviteService{
		db:           db,
		guildService: guildService,
	}
}

const inviteCodeAlphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

func generateInviteCode(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	for i, b := range bytes {
		bytes[i] = inviteCodeAlphabet[int(b)%len(inviteCodeAlphabet)]
	}
	return string(bytes), nil
}

// CreateInvite generates a new 8-character invite code for a guild
func (s *inviteService) CreateInvite(
	ctx context.Context,
	callerID snowflake.ID,
	guildID snowflake.ID,
	req *models.CreateInviteRequest,
) (*models.Invite, error) {
	// Verify caller is a guild member
	var isMember bool
	checkSQL := `SELECT EXISTS(SELECT 1 FROM members WHERE guild_id = $1 AND user_id = $2)`
	if err := s.db.QueryRow(ctx, checkSQL, guildID, callerID).Scan(&isMember); err != nil || !isMember {
		return nil, ErrForbidden
	}

	channelID := req.ChannelID
	if channelID == nil {
		// Pick first text channel (or any channel) for this guild
		var defaultChannelID snowflake.ID
		findChannelSQL := `
			SELECT id FROM channels
			WHERE guild_id = $1
			ORDER BY type ASC, position ASC, id ASC
			LIMIT 1
		`
		if err := s.db.QueryRow(ctx, findChannelSQL, guildID).Scan(&defaultChannelID); err != nil {
			return nil, fmt.Errorf("no channels found in guild: %w", err)
		}
		channelID = &defaultChannelID
	}

	var expiresAt *time.Time
	if req.MaxAge > 0 {
		exp := time.Now().Add(time.Duration(req.MaxAge) * time.Second)
		expiresAt = &exp
	}

	maxUses := req.MaxUses
	if maxUses < 0 {
		maxUses = 0
	}

	code, err := generateInviteCode(8)
	if err != nil {
		return nil, fmt.Errorf("generate invite code: %w", err)
	}

	const insertSQL = `
		INSERT INTO invites (code, guild_id, channel_id, inviter_id, uses, max_uses, expires_at, created_at)
		VALUES ($1, $2, $3, $4, 0, $5, $6, NOW())
		RETURNING code, guild_id, channel_id, inviter_id, uses, max_uses, expires_at, created_at
	`

	var inv models.Invite
	err = s.db.QueryRow(ctx, insertSQL, code, guildID, *channelID, callerID, maxUses, expiresAt).Scan(
		&inv.Code,
		&inv.GuildID,
		&inv.ChannelID,
		&inv.InviterID,
		&inv.Uses,
		&inv.MaxUses,
		&inv.ExpiresAt,
		&inv.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert invite: %w", err)
	}

	return &inv, nil
}

// GetInvite fetches invite details including guild summary, channel name, and inviter
func (s *inviteService) GetInvite(ctx context.Context, code string) (*models.InviteResponse, error) {
	const querySQL = `
		SELECT i.code, i.guild_id, i.channel_id, i.inviter_id, i.uses, i.max_uses, i.expires_at, i.created_at,
		       g.id, g.name, g.icon,
		       c.id, c.name, c.type,
		       u.id, u.username, u.global_name, u.avatar,
		       (SELECT COUNT(*) FROM members WHERE guild_id = i.guild_id) AS member_count
		FROM invites i
		JOIN guilds g ON i.guild_id = g.id
		JOIN channels c ON i.channel_id = c.id
		JOIN users u ON i.inviter_id = u.id
		WHERE i.code = $1
	`

	var resp models.InviteResponse
	var g models.InviteGuildSummary
	var c models.InviteChannelSummary
	var u models.UserSummary

	err := s.db.QueryRow(ctx, querySQL, code).Scan(
		&resp.Code,
		&resp.GuildID,
		&resp.ChannelID,
		&resp.InviterID,
		&resp.Uses,
		&resp.MaxUses,
		&resp.ExpiresAt,
		&resp.CreatedAt,
		&g.ID,
		&g.Name,
		&g.Icon,
		&c.ID,
		&c.Name,
		&c.Type,
		&u.ID,
		&u.Username,
		&u.GlobalName,
		&u.Avatar,
		&g.MemberCount,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInviteNotFound
		}
		return nil, fmt.Errorf("query invite: %w", err)
	}

	// Validate expiration
	if resp.ExpiresAt != nil && time.Now().After(*resp.ExpiresAt) {
		return nil, ErrInviteNotFound
	}

	// Validate max uses
	if resp.MaxUses > 0 && resp.Uses >= resp.MaxUses {
		return nil, ErrInviteNotFound
	}

	resp.Guild = g
	resp.Channel = c
	resp.Inviter = u

	return &resp, nil
}

// UseInvite redeems an invite code, adds caller to members, and assigns @everyone role
func (s *inviteService) UseInvite(
	ctx context.Context,
	callerID snowflake.ID,
	code string,
) (*models.GuildDetailResponse, *models.MemberResponse, error) {
	// First fetch and validate invite
	invite, err := s.GetInvite(ctx, code)
	if err != nil {
		return nil, nil, err
	}

	guildID := invite.GuildID

	// Check if user is banned from this guild
	var isBanned bool
	checkBanSQL := `SELECT EXISTS(SELECT 1 FROM bans WHERE guild_id = $1 AND user_id = $2)`
	if err := s.db.QueryRow(ctx, checkBanSQL, guildID, callerID).Scan(&isBanned); err != nil {
		return nil, nil, fmt.Errorf("check ban: %w", err)
	}
	if isBanned {
		return nil, nil, ErrBanned
	}

	// Check if already a member
	var isMember bool
	checkSQL := `SELECT EXISTS(SELECT 1 FROM members WHERE guild_id = $1 AND user_id = $2)`
	if err := s.db.QueryRow(ctx, checkSQL, guildID, callerID).Scan(&isMember); err != nil {
		return nil, nil, fmt.Errorf("check member: %w", err)
	}

	if isMember {
		// Already member, return guild details
		guildDetail, err := s.guildService.GetGuildDetails(ctx, callerID, guildID)
		if err != nil {
			return nil, nil, err
		}
		return guildDetail, nil, nil
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Insert member
	const insertMemberSQL = `
		INSERT INTO members (guild_id, user_id, nick, joined_at, deaf, mute, flags)
		VALUES ($1, $2, NULL, NOW(), FALSE, FALSE, 0)
		RETURNING guild_id, user_id, nick, joined_at, deaf, mute, flags
	`
	var m models.Member
	if err := tx.QueryRow(ctx, insertMemberSQL, guildID, callerID).Scan(
		&m.GuildID,
		&m.UserID,
		&m.Nick,
		&m.JoinedAt,
		&m.Deaf,
		&m.Mute,
		&m.Flags,
	); err != nil {
		return nil, nil, fmt.Errorf("insert member: %w", err)
	}

	// Assign @everyone role
	var everyoneRoleID snowflake.ID
	findRoleSQL := `SELECT id FROM roles WHERE guild_id = $1 AND name = '@everyone' LIMIT 1`
	if err := tx.QueryRow(ctx, findRoleSQL, guildID).Scan(&everyoneRoleID); err == nil {
		const insertRoleSQL = `
			INSERT INTO member_roles (guild_id, user_id, role_id)
			VALUES ($1, $2, $3)
			ON CONFLICT DO NOTHING
		`
		_, _ = tx.Exec(ctx, insertRoleSQL, guildID, callerID, everyoneRoleID)
	}

	// Increment uses
	const updateUsesSQL = `UPDATE invites SET uses = uses + 1 WHERE code = $1`
	_, _ = tx.Exec(ctx, updateUsesSQL, code)

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("commit tx: %w", err)
	}

	// Fetch user details for member response
	var u models.UserSummary
	userSQL := `SELECT id, username, global_name, avatar FROM users WHERE id = $1`
	_ = s.db.QueryRow(ctx, userSQL, callerID).Scan(&u.ID, &u.Username, &u.GlobalName, &u.Avatar)

	var assignedRoles []snowflake.ID
	if everyoneRoleID != 0 {
		assignedRoles = []snowflake.ID{everyoneRoleID}
	} else {
		assignedRoles = make([]snowflake.ID, 0)
	}

	memberResp := &models.MemberResponse{
		GuildID:  guildID,
		UserID:   callerID,
		Nick:     m.Nick,
		Roles:    assignedRoles,
		JoinedAt: m.JoinedAt,
		Deaf:     m.Deaf,
		Mute:     m.Mute,
		Flags:    m.Flags,
		User:     u,
	}

	guildDetail, err := s.guildService.GetGuildDetails(ctx, callerID, guildID)
	if err != nil {
		return nil, memberResp, nil
	}

	return guildDetail, memberResp, nil
}

// ListMembers lists all members of a guild with user profiles
func (s *inviteService) ListMembers(
	ctx context.Context,
	callerID snowflake.ID,
	guildID snowflake.ID,
) ([]models.MemberResponse, error) {
	// Verify caller is a member
	var isMember bool
	checkSQL := `SELECT EXISTS(SELECT 1 FROM members WHERE guild_id = $1 AND user_id = $2)`
	if err := s.db.QueryRow(ctx, checkSQL, guildID, callerID).Scan(&isMember); err != nil || !isMember {
		return nil, ErrForbidden
	}

	const querySQL = `
		SELECT m.guild_id, m.user_id, m.nick, m.joined_at, m.deaf, m.mute, m.flags,
		       u.id, u.username, u.global_name, u.avatar
		FROM members m
		JOIN users u ON m.user_id = u.id
		WHERE m.guild_id = $1
		ORDER BY m.joined_at ASC
	`

	rows, err := s.db.Query(ctx, querySQL, guildID)
	if err != nil {
		return nil, fmt.Errorf("query members: %w", err)
	}
	defer rows.Close()

	// Query member roles for the guild
	memberRolesMap := make(map[snowflake.ID][]snowflake.ID)
	mrRows, err := s.db.Query(ctx, `SELECT user_id, role_id FROM member_roles WHERE guild_id = $1`, guildID)
	if err == nil {
		defer mrRows.Close()
		for mrRows.Next() {
			var uID, rID snowflake.ID
			if err := mrRows.Scan(&uID, &rID); err == nil {
				memberRolesMap[uID] = append(memberRolesMap[uID], rID)
			}
		}
	}

	members := make([]models.MemberResponse, 0)
	for rows.Next() {
		var m models.MemberResponse
		if err := rows.Scan(
			&m.GuildID,
			&m.UserID,
			&m.Nick,
			&m.JoinedAt,
			&m.Deaf,
			&m.Mute,
			&m.Flags,
			&m.User.ID,
			&m.User.Username,
			&m.User.GlobalName,
			&m.User.Avatar,
		); err != nil {
			return nil, fmt.Errorf("scan member: %w", err)
		}
		if roles, ok := memberRolesMap[m.UserID]; ok {
			m.Roles = roles
		} else {
			m.Roles = make([]snowflake.ID, 0)
		}
		members = append(members, m)
	}

	return members, nil
}
