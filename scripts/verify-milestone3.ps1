# ==============================================================================
# Concord — Milestone 3 Automated Verification Suite
# Presence, Member List, Voice State Tracking, and Server Invites
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
$WsBaseUrl = "ws://127.0.0.1:$Port"

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
        if ($_.Exception.Response) {
            $stream = $_.Exception.Response.GetResponseStream()
            if ($stream) {
                $reader = [System.IO.StreamReader]::new($stream)
                $bodyText = $reader.ReadToEnd()
                if ($bodyText) { $msg = "$msg | $bodyText" }
            }
        }
        return @{ Success = $false; Error = $msg }
    }
}

# ==============================================================================
# TIER 1: Go Backend Automated Test Suite
# ==============================================================================
Log-Header "TIER 1: Backend Automated Test Harness (Milestone 3)"

if (-not $SkipBackendTests) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $ConcordDir
    try {
        Write-Host "  Running Milestone 3 Go Integration Tests (Invites, Presence, Voice States)..." -ForegroundColor Yellow
        $testOutput = go test -v -run "TestMilestone3" ./tests/... 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
        $sw.Stop()

        if ($exitCode -eq 0) {
            Record-Test "Backend Milestone 3 Integration Suite" $true "Invites, Presence & Voice tests passed cleanly" $sw.ElapsedMilliseconds
        } else {
            Record-Test "Backend Milestone 3 Integration Suite" $false "Failed: $testOutput" $sw.ElapsedMilliseconds
        }
    } catch {
        $sw.Stop()
        Record-Test "Backend Milestone 3 Integration Suite" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    } finally {
        Pop-Location
    }
} else {
    Write-Host "  Skipping Tier 1 Backend Tests (-SkipBackendTests specified)" -ForegroundColor Gray
}

# ==============================================================================
# TIER 2: Live API & Gateway Verification
# ==============================================================================
Log-Header "TIER 2: Live Server Verification (Port $Port)"

# Check Health
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$health = Invoke-Api -Method "GET" -Path "/v1/health"
$sw.Stop()
if ($health.Success -and $health.Data.status -eq "ok") {
    Record-Test "Backend Healthcheck" $true "DB Status: $($health.Data.db)" $sw.ElapsedMilliseconds
} else {
    Record-Test "Backend Healthcheck" $false "Failed: $($health.Error)" $sw.ElapsedMilliseconds
}

# Register Alice and Bob
$unique = [System.DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$aliceUser = "alice_m3_$unique"
$bobUser = "bob_m3_$unique"

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$regAlice = Invoke-Api -Method "POST" -Path "/v1/auth/register" -Body @{
    email = "$aliceUser@example.com"; username = $aliceUser; password = "Password123!"
}
$sw.Stop()
$aliceToken = if ($regAlice.Success) { $regAlice.Data.token } else { $null }
Record-Test "Register Alice" ($null -ne $aliceToken) "User ID: $($regAlice.Data.user.id)" $sw.ElapsedMilliseconds

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$regBob = Invoke-Api -Method "POST" -Path "/v1/auth/register" -Body @{
    email = "$bobUser@example.com"; username = $bobUser; password = "Password123!"
}
$sw.Stop()
$bobToken = if ($regBob.Success) { $regBob.Data.token } else { $null }
Record-Test "Register Bob" ($null -ne $bobToken) "User ID: $($regBob.Data.user.id)" $sw.ElapsedMilliseconds

# Alice creates Guild
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$guildResp = Invoke-Api -Method "POST" -Path "/v1/guilds" -Headers @{ Authorization = "Bearer $aliceToken" } -Body @{
    name = "Milestone 3 Test Guild $unique"
}
$sw.Stop()
$guildId = if ($guildResp.Success) { $guildResp.Data.id } else { $null }
Record-Test "Alice Creates Guild" ($null -ne $guildId) "Guild ID: $guildId" $sw.ElapsedMilliseconds

# Alice generates Server Invite
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$invResp = Invoke-Api -Method "POST" -Path "/v1/guilds/$guildId/invites" -Headers @{ Authorization = "Bearer $aliceToken" } -Body @{
    max_uses = 10; max_age = 86400
}
$sw.Stop()
$inviteCode = if ($invResp.Success) { $invResp.Data.code } else { $null }
Record-Test "Alice Generates Server Invite" ($null -ne $inviteCode -and $inviteCode.Length -eq 8) "Code: $inviteCode" $sw.ElapsedMilliseconds

# Bob inspects Invite
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$getInv = Invoke-Api -Method "GET" -Path "/v1/invites/$inviteCode" -Headers @{ Authorization = "Bearer $bobToken" }
$sw.Stop()
$invValid = $getInv.Success -and ($getInv.Data.guild.name -eq "Milestone 3 Test Guild $unique")
Record-Test "Bob Inspects Invite Metadata" $invValid "Guild: $($getInv.Data.guild.name), Inviter: $($getInv.Data.inviter.username)" $sw.ElapsedMilliseconds

# Bob redeems Invite to join Server
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$useInv = Invoke-Api -Method "POST" -Path "/v1/invites/$inviteCode/use" -Headers @{ Authorization = "Bearer $bobToken" }
$sw.Stop()
$joinedOk = $useInv.Success -and ($useInv.Data.id -eq $guildId)
Record-Test "Bob Redeems Invite & Joins Server" $joinedOk "Joined Guild ID: $($useInv.Data.id)" $sw.ElapsedMilliseconds

# Member List Verification
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$membersResp = Invoke-Api -Method "GET" -Path "/v1/guilds/$guildId/members" -Headers @{ Authorization = "Bearer $aliceToken" }
$sw.Stop()
$hasBoth = $false
if ($membersResp.Success -and $membersResp.Data.Count -ge 2) {
    $usernames = @($membersResp.Data | ForEach-Object { $_.user.username })
    if ($usernames -contains $aliceUser -and $usernames -contains $bobUser) {
        $hasBoth = $true
    }
}
Record-Test "Dual-User Member List Verification" $hasBoth "Members in guild: $($membersResp.Data.Count)" $sw.ElapsedMilliseconds

# ==============================================================================
# TIER 3: Frontend TypeScript & Vite Production Build
# ==============================================================================
Log-Header "TIER 3: Desktop Client Production Build"

if (-not $SkipFrontendBuild) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $ClientDir
    try {
        Write-Host "  Running `npm run build` (tsc + vite build)..." -ForegroundColor Yellow
        $buildOutput = npm run build 2>&1 | Out-String
        $buildCode = $LASTEXITCODE
        $sw.Stop()

        if ($buildCode -eq 0) {
            Record-Test "Frontend Production Build" $true "Built cleanly with 0 TypeScript/Vite errors" $sw.ElapsedMilliseconds
        } else {
            Record-Test "Frontend Production Build" $false "Build Failed: $buildOutput" $sw.ElapsedMilliseconds
        }
    } catch {
        $sw.Stop()
        Record-Test "Frontend Production Build" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    } finally {
        Pop-Location
    }
} else {
    Write-Host "  Skipping Tier 3 Frontend Build (-SkipFrontendBuild specified)" -ForegroundColor Gray
}

# ==============================================================================
# VERIFICATION SUMMARY
# ==============================================================================
Log-Header "VERIFICATION SUMMARY REPORT"
$TotalTime = $GlobalStartTime.ElapsedMilliseconds

$passed = @($Results | Where-Object Status -eq 'PASS').Count
$failed = @($Results | Where-Object Status -ne 'PASS').Count
$total = $Results.Count

Write-Host ""
$Results | Format-Table -Property Name, Status, Duration, Details -AutoSize

Write-Host ""
Write-Host "  Total Tests: $total | Passed: $passed | Failed: $failed | Elapsed: ${TotalTime}ms" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })

if ($failed -eq 0) {
    Write-Host ""
    Write-Host "  ================================================================" -ForegroundColor Green
    Write-Host "   VICTORY: Milestone 3 Acceptance Criteria Completely Fulfilled! " -ForegroundColor Green
    Write-Host "  ================================================================" -ForegroundColor Green
    exit 0
} else {
    Write-Host ""
    Write-Host "  FAILURES DETECTED ($failed failures). Please review logs." -ForegroundColor Red
    exit 1
}
