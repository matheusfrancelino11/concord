# ==============================================================================
# Concord — Milestone 6 Automated Verification Suite
# Administration, Bitfield Permissions, Roles, Moderation & Bans
# ==============================================================================

[CmdletBinding()]
param(
    [int]$Port = 8080,
    [switch]$SkipBackendTests = $false,
    [switch]$SkipFrontendBuild = $false
)

$ErrorActionPreference = "Stop"
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

# Resolve repository paths
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$ConcordDir = Join-Path $RepoRoot "concord"
$ClientDir = Join-Path $RepoRoot "concord-client"
$BaseUrl = "http://127.0.0.1:$Port"

$Results = [System.Collections.Generic.List[PSCustomObject]]::new()
$GlobalStartTime = [System.Diagnostics.Stopwatch]::StartNew()

function Log-Header {
    param([string]$Title)
    Write-Host ""
    Write-Host ("=" * 80) -ForegroundColor Cyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host ("=" * 80) -ForegroundColor Cyan
}

function Record-Test {
    param(
        [string]$Name,
        [bool]$Success,
        [string]$Details,
        [long]$ElapsedMs
    )
    $statusStr = if ($Success) { "PASS" } else { "FAIL" }
    $color = if ($Success) { "Green" } else { "Red" }
    $timeStr = "${ElapsedMs}ms"
    Write-Host "  [$statusStr] $Name - $Details ($timeStr)" -ForegroundColor $color
    $Results.Add([PSCustomObject]@{
        Name     = $Name
        Status   = $statusStr
        Details  = $Details
        Duration = $timeStr
    })
}

function Invoke-Api {
    param(
        [string]$Method,
        [string]$Path,
        [hashtable]$Headers = @{},
        $Body = $null
    )
    $uri = "$BaseUrl$Path"
    $reqHeaders = @{ "Content-Type" = "application/json" }
    foreach ($k in $Headers.Keys) { $reqHeaders[$k] = $Headers[$k] }

    $jsonBody = $null
    if ($null -ne $Body) {
        $jsonBody = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Compress -Depth 10 }
    }

    try {
        if ($null -ne $jsonBody) {
            $resp = Invoke-RestMethod -Uri $uri -Method $Method -Headers $reqHeaders -Body $jsonBody -TimeoutSec 10
        } else {
            $resp = Invoke-RestMethod -Uri $uri -Method $Method -Headers $reqHeaders -TimeoutSec 10
        }
        return @{ Success = $true; Data = $resp }
    } catch {
        $msg = $_.Exception.Message
        $statusCode = 500
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
            $stream = $_.Exception.Response.GetResponseStream()
            if ($stream) {
                $reader = [System.IO.StreamReader]::new($stream)
                $bodyText = $reader.ReadToEnd()
                if ($bodyText) { $msg = "$msg | $bodyText" }
            }
        }
        return @{ Success = $false; StatusCode = $statusCode; Error = $msg }
    }
}

Log-Header "CONCORD MILESTONE 6: ADMINISTRATION & PERMISSIONS SUITE"
Write-Host "Target API: $BaseUrl" -ForegroundColor Gray
Write-Host "Concord Directory: $ConcordDir" -ForegroundColor Gray
Write-Host "Client Directory:  $ClientDir" -ForegroundColor Gray

# ------------------------------------------------------------------------------
# STEP 1: Health Check
# ------------------------------------------------------------------------------
Log-Header "Step 1: Health & Database Connectivity"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$health = Invoke-Api -Method "GET" -Path "/health"
$sw.Stop()

if ($health.Success -and $health.Data.status -eq "ok" -and $health.Data.db -eq "healthy") {
    Record-Test "Backend & DB Healthy" $true "DB Status: $($health.Data.db)" $sw.ElapsedMilliseconds
} else {
    Record-Test "Backend & DB Healthy" $false "Health check failed: $($health.Error)" $sw.ElapsedMilliseconds
    throw "Backend health check failed. Verify server is listening on port $Port."
}

# ------------------------------------------------------------------------------
# STEP 2: Backend Automated Tests (Go Test)
# ------------------------------------------------------------------------------
if (-not $SkipBackendTests) {
    Log-Header "Step 2: Go Backend Unit/Integration Tests"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $ConcordDir
    try {
        $testOutput = go test -v -count=1 ./tests -run TestMilestone6 2>&1 | Out-String
        $testPassed = $LASTEXITCODE -eq 0
        $sw.Stop()
        if ($testPassed) {
            Record-Test "Go Milestone 6 Tests" $true "All permissions & admin tests passed" $sw.ElapsedMilliseconds
        } else {
            Record-Test "Go Milestone 6 Tests" $false "Go test failed:`n$testOutput" $sw.ElapsedMilliseconds
            throw "Go backend tests failed."
        }
    } finally {
        Pop-Location
    }
}

# ------------------------------------------------------------------------------
# STEP 3: Setup Test Users & Guild
# ------------------------------------------------------------------------------
Log-Header "Step 3: Setup Test Users & Server"
$Unique = [System.DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

# User A (Owner)
$userAEmail = "owner_${Unique}@concord.test"
$userAPass = "ConcordPass123!"
$regA = Invoke-Api -Method "POST" -Path "/v1/auth/register" -Body @{
    email = $userAEmail
    username = "owner_${Unique}"
    password = $userAPass
    global_name = "Server Owner"
}
$tokenA = $regA.Data.token
$userAId = $regA.Data.user.id
$authHeadersA = @{ "Authorization" = "Bearer $tokenA" }

# User B (Moderator)
$userBEmail = "mod_${Unique}@concord.test"
$regB = Invoke-Api -Method "POST" -Path "/v1/auth/register" -Body @{
    email = $userBEmail
    username = "mod_${Unique}"
    password = $userAPass
    global_name = "Moderator Bob"
}
$tokenB = $regB.Data.token
$userBId = $regB.Data.user.id
$authHeadersB = @{ "Authorization" = "Bearer $tokenB" }

# User C (Regular Member)
$userCEmail = "member_${Unique}@concord.test"
$regC = Invoke-Api -Method "POST" -Path "/v1/auth/register" -Body @{
    email = $userCEmail
    username = "member_${Unique}"
    password = $userAPass
    global_name = "Charlie Member"
}
$tokenC = $regC.Data.token
$userCId = $regC.Data.user.id
$authHeadersC = @{ "Authorization" = "Bearer $tokenC" }

# Create Guild
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$createGuild = Invoke-Api -Method "POST" -Path "/v1/guilds" -Headers $authHeadersA -Body @{
    name = "Admin Verification Guild"
}
$sw.Stop()
$guildId = $createGuild.Data.id
Record-Test "Server Creation" $createGuild.Success "Guild ID: $guildId" $sw.ElapsedMilliseconds

# ------------------------------------------------------------------------------
# STEP 4: Role Management (Create, List, Update, @everyone immutability)
# ------------------------------------------------------------------------------
Log-Header "Step 4: Role Management API"

# 4.1 Create Role "Mod Squad"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$createRole = Invoke-Api -Method "POST" -Path "/v1/guilds/$guildId/roles" -Headers $authHeadersA -Body @{
    name = "Mod Squad"
    permissions = "6" # Kick (1<<1 = 2) | Ban (1<<2 = 4) = 6
    color = 65280     # Green
    hoist = $true
}
$sw.Stop()
$roleId = $createRole.Data.id
$createRoleOk = $createRole.Success -and ($createRole.Data.name -eq "Mod Squad") -and ($null -ne $roleId)
Record-Test "Create Custom Role" $createRoleOk "Role ID: $roleId | Perms: $($createRole.Data.permissions)" $sw.ElapsedMilliseconds

# 4.2 List Roles
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$listRoles = Invoke-Api -Method "GET" -Path "/v1/guilds/$guildId/roles" -Headers $authHeadersA
$sw.Stop()
$listRolesOk = $listRoles.Success -and ($listRoles.Data.Count -ge 2)
Record-Test "List Guild Roles" $listRolesOk "Found $($listRoles.Data.Count) roles (@everyone + custom)" $sw.ElapsedMilliseconds

# Find @everyone role ID
$everyoneRoleId = ($listRoles.Data | Where-Object { $_.position -eq 0 -or $_.name -eq "@everyone" }).id

# 4.3 Update Role "Mod Squad" -> "Senior Mods"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$updateRole = Invoke-Api -Method "PATCH" -Path "/v1/guilds/$guildId/roles/$roleId" -Headers $authHeadersA -Body @{
    name = "Senior Mods"
    color = 16711680 # Red
}
$sw.Stop()
$updateRoleOk = $updateRole.Success -and ($updateRole.Data.name -eq "Senior Mods")
Record-Test "Update Role Properties" $updateRoleOk "New Name: $($updateRole.Data.name)" $sw.ElapsedMilliseconds

# 4.4 Invariant: @everyone cannot be renamed
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$renameEveryone = Invoke-Api -Method "PATCH" -Path "/v1/guilds/$guildId/roles/$everyoneRoleId" -Headers $authHeadersA -Body @{
    name = "Renamed Everyone"
}
$sw.Stop()
$renameBlocked = (-not $renameEveryone.Success) -and ($renameEveryone.StatusCode -eq 400)
Record-Test "@everyone Immutability Invariant" $renameBlocked "HTTP 400 Bad Request when attempting rename" $sw.ElapsedMilliseconds

# ------------------------------------------------------------------------------
# STEP 5: Invites, Member Roles & Moderation (Kick & Ban)
# ------------------------------------------------------------------------------
Log-Header "Step 5: Invites, Member Role Assignment & Moderation"

# 5.1 Create Invite
$inv = Invoke-Api -Method "POST" -Path "/v1/guilds/$guildId/invites" -Headers $authHeadersA -Body @{}
$inviteCode = $inv.Data.code

# User B and User C join
$null = Invoke-Api -Method "POST" -Path "/v1/invites/$inviteCode/use" -Headers $authHeadersB
$null = Invoke-Api -Method "POST" -Path "/v1/invites/$inviteCode/use" -Headers $authHeadersC

# 5.2 Assign Role to User B
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$assignRole = Invoke-Api -Method "PUT" -Path "/v1/guilds/$guildId/members/$userBId/roles/$roleId" -Headers $authHeadersA
$sw.Stop()
Record-Test "Assign Role to Member" $assignRole.Success "Assigned Senior Mods to Bob" $sw.ElapsedMilliseconds

# Verify member list has Bob's role
$members = Invoke-Api -Method "GET" -Path "/v1/guilds/$guildId/members" -Headers $authHeadersA
$bobRecord = $members.Data | Where-Object { $_.user_id -eq $userBId }
$bobHasRole = ($bobRecord.roles -contains $roleId)
Record-Test "Verify Member Role Persistence" $bobHasRole "Bob roles: $($bobRecord.roles -join ', ')" 0

# 5.3 Kick Charlie (User C)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$kick = Invoke-Api -Method "DELETE" -Path "/v1/guilds/$guildId/members/$userCId" -Headers $authHeadersA
$sw.Stop()
Record-Test "Kick Member" $kick.Success "Charlie was kicked from guild" $sw.ElapsedMilliseconds

# Verify Charlie can rejoin via invite
$rejoin = Invoke-Api -Method "POST" -Path "/v1/invites/$inviteCode/use" -Headers $authHeadersC
Record-Test "Rejoin After Kick" $rejoin.Success "Charlie rejoined using invite code" 0

# 5.4 Ban Charlie (User C)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$ban = Invoke-Api -Method "PUT" -Path "/v1/guilds/$guildId/bans/$userCId" -Headers $authHeadersA -Body @{
    reason = "Spamming voice channels"
    delete_message_days = 1
}
$sw.Stop()
Record-Test "Ban Member" $ban.Success "Charlie banned with reason" $sw.ElapsedMilliseconds

# 5.5 Invariant: Banned user attempting invite redemption is rejected with 403 Forbidden
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$bannedJoin = Invoke-Api -Method "POST" -Path "/v1/invites/$inviteCode/use" -Headers $authHeadersC
$sw.Stop()
$banRejected = (-not $bannedJoin.Success) -and ($bannedJoin.StatusCode -eq 403)
Record-Test "Banned Invite Redemption Rejection" $banRejected "HTTP 403 Forbidden received as expected" $sw.ElapsedMilliseconds

# 5.6 List Bans
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$bansList = Invoke-Api -Method "GET" -Path "/v1/guilds/$guildId/bans" -Headers $authHeadersA
$sw.Stop()
$bansListOk = $bansList.Success -and ($bansList.Data.Count -ge 1) -and ($bansList.Data[0].user.id -eq $userCId)
Record-Test "List Server Bans" $bansListOk "Charlie found in bans with reason: $($bansList.Data[0].reason)" $sw.ElapsedMilliseconds

# 5.7 Unban Charlie
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$unban = Invoke-Api -Method "DELETE" -Path "/v1/guilds/$guildId/bans/$userCId" -Headers $authHeadersA
$sw.Stop()
Record-Test "Unban Member" $unban.Success "Charlie unbanned" $sw.ElapsedMilliseconds

# 5.8 Charlie can now redeem invite
$afterUnbanJoin = Invoke-Api -Method "POST" -Path "/v1/invites/$inviteCode/use" -Headers $authHeadersC
Record-Test "Rejoin After Unban" $afterUnbanJoin.Success "Charlie successfully joined after unban" 0

# ------------------------------------------------------------------------------
# STEP 6: Server Update API (Name & Icon)
# ------------------------------------------------------------------------------
Log-Header "Step 6: Server Update API"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$patchGuild = Invoke-Api -Method "PATCH" -Path "/v1/guilds/$guildId" -Headers $authHeadersA -Body @{
    name = "Concord Elite Hangout"
    icon = "https://cdn.concord.app/icons/elite.png"
}
$sw.Stop()
$patchOk = $patchGuild.Success -and ($patchGuild.Data.name -eq "Concord Elite Hangout") -and ($patchGuild.Data.icon -eq "https://cdn.concord.app/icons/elite.png")
Record-Test "Update Server Name & Icon" $patchOk "Server updated to: $($patchGuild.Data.name)" $sw.ElapsedMilliseconds

# ------------------------------------------------------------------------------
# STEP 7: Frontend Build Verification
# ------------------------------------------------------------------------------
if (-not $SkipFrontendBuild) {
    Log-Header "Step 7: Frontend Production Build"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $ClientDir
    try {
        $prevPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $buildOutput = npm run build 2>&1 | Out-String
        $ErrorActionPreference = $prevPreference
        $buildPassed = $LASTEXITCODE -eq 0
        $sw.Stop()
        if ($buildPassed) {
            Record-Test "Frontend Production Build" $true "Vite & TypeScript compilation passed" $sw.ElapsedMilliseconds
        } else {
            Record-Test "Frontend Production Build" $false "Build error:`n$buildOutput" $sw.ElapsedMilliseconds
            throw "Frontend build failed."
        }
    } finally {
        Pop-Location
    }
}

# ------------------------------------------------------------------------------
# SUMMARY REPORT
# ------------------------------------------------------------------------------
$GlobalStartTime.Stop()
Log-Header "MILESTONE 6 VERIFICATION SUMMARY"

$passedCount = ($Results | Where-Object { $_.Status -eq "PASS" }).Count
$totalCount = $Results.Count
$overallColor = if ($passedCount -eq $totalCount) { "Green" } else { "Red" }

Write-Host "Total Tests:    $totalCount" -ForegroundColor White
Write-Host "Passed Tests:   $passedCount" -ForegroundColor $overallColor
Write-Host "Failed Tests:   $($totalCount - $passedCount)" -ForegroundColor $overallColor
Write-Host "Total Duration: $($GlobalStartTime.ElapsedMilliseconds)ms" -ForegroundColor Cyan
Write-Host ""

if ($passedCount -ne $totalCount) {
    throw "Milestone 6 verification failed: $($totalCount - $passedCount) tests failed."
}

Write-Host "All Milestone 6 verification checks passed successfully!" -ForegroundColor Green
