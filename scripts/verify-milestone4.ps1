# ==============================================================================
# Concord — Milestone 4 Automated Verification Suite
# LiveKit SFU Voice Channels, Token Generation, Audio Controls & State
# ==============================================================================

[CmdletBinding()]
param(
    [int]$Port = 8080,
    [int]$LiveKitPort = 7880,
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
$LiveKitUrl = "http://127.0.0.1:$LiveKitPort"

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

# ==============================================================================
# TIER 1: LiveKit SFU Server Process & Go Backend Integration Tests
# ==============================================================================
Log-Header "TIER 1: LiveKit SFU Server & Go Backend Automated Tests"

# 1.1 Verify LiveKit Server is reachable
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $lkTcp = Test-NetConnection -ComputerName "127.0.0.1" -Port $LiveKitPort -WarningAction SilentlyContinue
    $sw.Stop()
    if ($lkTcp.TcpTestSucceeded) {
        Record-Test "LiveKit Server Reachable" $true "Listening on 127.0.0.1:$LiveKitPort" $sw.ElapsedMilliseconds
    } else {
        Record-Test "LiveKit Server Reachable" $false "Failed to connect to 127.0.0.1:$LiveKitPort" $sw.ElapsedMilliseconds
    }
} catch {
    $sw.Stop()
    Record-Test "LiveKit Server Reachable" $false $_.Message $sw.ElapsedMilliseconds
}

# 1.2 Run Go Backend Milestone 4 Unit & Integration Tests
if (-not $SkipBackendTests) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $ConcordDir
    try {
        Write-Host "  Running Milestone 4 Go Tests (LiveKit Token Generation & Verification)..." -ForegroundColor Yellow
        $output = & go test -v -run TestMilestone4 ./tests/... 2>&1
        $exitCode = $LASTEXITCODE
        $sw.Stop()
        if ($exitCode -eq 0) {
            Record-Test "Go Backend Milestone 4 Tests" $true "All token generation & cryptographic signature checks passed" $sw.ElapsedMilliseconds
        } else {
            $errSnippet = ($output | Out-String).Trim()
            Record-Test "Go Backend Milestone 4 Tests" $false "Go test failed: $errSnippet" $sw.ElapsedMilliseconds
        }
    } catch {
        $sw.Stop()
        Record-Test "Go Backend Milestone 4 Tests" $false $_.Message $sw.ElapsedMilliseconds
    } finally {
        Pop-Location
    }
}

# ==============================================================================
# TIER 2: Live REST API Voice Token End-to-End Tests
# ==============================================================================
Log-Header "TIER 2: Live REST API Voice Token Endpoints"

$unique = [System.DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

# 2.1 Backend Health
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$healthRes = Invoke-Api -Method "GET" -Path "/v1/health"
$sw.Stop()
if ($healthRes.Success -and $healthRes.Data.status -eq "ok") {
    Record-Test "Backend Health Endpoint" $true "DB: $($healthRes.Data.db)" $sw.ElapsedMilliseconds
} else {
    Record-Test "Backend Health Endpoint" $false "Failed: $($healthRes.Error)" $sw.ElapsedMilliseconds
}

# 2.2 Register Alice (Server Owner) & Bob (Non-Member)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$aliceRes = Invoke-Api -Method "POST" -Path "/v1/auth/register" -Body @{
    username = "m4_alice_$unique"
    email    = "m4_alice_$unique@test.com"
    password = "Password123!"
}
$bobRes = Invoke-Api -Method "POST" -Path "/v1/auth/register" -Body @{
    username = "m4_bob_$unique"
    email    = "m4_bob_$unique@test.com"
    password = "Password123!"
}
$sw.Stop()

$aliceToken = if ($aliceRes.Success) { $aliceRes.Data.token } else { $null }
$bobToken = if ($bobRes.Success) { $bobRes.Data.token } else { $null }
$aliceAuth = @{ "Authorization" = "Bearer $aliceToken" }
$bobAuth = @{ "Authorization" = "Bearer $bobToken" }

if ($aliceToken -and $bobToken) {
    Record-Test "Register Test Users" $true "Alice ID: $($aliceRes.Data.user.id) | Bob ID: $($bobRes.Data.user.id)" $sw.ElapsedMilliseconds
} else {
    Record-Test "Register Test Users" $false "Registration failed: Alice: $($aliceRes.Error) | Bob: $($bobRes.Error)" $sw.ElapsedMilliseconds
}

# 2.3 Alice creates guild
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$guildRes = Invoke-Api -Method "POST" -Path "/v1/guilds" -Headers $aliceAuth -Body @{
    name = "Milestone 4 Voice Realm"
}
$sw.Stop()
$guildId = $guildRes.Data.id
if ($guildRes.Success -and $guildId) {
    Record-Test "Create Guild" $true "Guild ID: $guildId" $sw.ElapsedMilliseconds
} else {
    Record-Test "Create Guild" $false "Failed: $($guildRes.Error)" $sw.ElapsedMilliseconds
}

# Find default text channel
$textChannel = $guildRes.Data.channels | Where-Object { $_.type -eq 0 } | Select-Object -First 1
$textChannelId = $textChannel.id

# 2.4 Alice creates Voice Channel (type = 2)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$voiceChanRes = Invoke-Api -Method "POST" -Path "/v1/guilds/$guildId/channels" -Headers $aliceAuth -Body @{
    name = "General Voice Room"
    type = 2
}
$sw.Stop()
$voiceChannelId = $voiceChanRes.Data.id
if ($voiceChanRes.Success -and $voiceChannelId -and $voiceChanRes.Data.type -eq 2) {
    Record-Test "Create Voice Channel (type=2)" $true "Channel ID: $voiceChannelId" $sw.ElapsedMilliseconds
} else {
    Record-Test "Create Voice Channel (type=2)" $false "Failed: $($voiceChanRes.Error)" $sw.ElapsedMilliseconds
}

# 2.5 Alice requests LiveKit voice token for the voice channel
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$tokenRes = Invoke-Api -Method "POST" -Path "/v1/channels/$voiceChannelId/voice/token" -Headers $aliceAuth
$sw.Stop()

$expectedRoom = "guild_${guildId}_channel_${voiceChannelId}"
if ($tokenRes.Success -and $tokenRes.Data.token -and $tokenRes.Data.room -eq $expectedRoom) {
    $jwtParts = $tokenRes.Data.token.Split('.')
    $isJwtFormat = ($jwtParts.Length -eq 3)
    if ($isJwtFormat) {
        Record-Test "Generate LiveKit Voice Token" $true "Room: $($tokenRes.Data.room) | LiveKit URL: $($tokenRes.Data.url)" $sw.ElapsedMilliseconds
    } else {
        Record-Test "Generate LiveKit Voice Token" $false "Token returned is not 3-part JWT" $sw.ElapsedMilliseconds
    }
} else {
    Record-Test "Generate LiveKit Voice Token" $false "Failed: $($tokenRes.Error)" $sw.ElapsedMilliseconds
}

# 2.6 Bob (Non-Member) requests token for voice channel -> Expect 403 Forbidden
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$bobForbiddenRes = Invoke-Api -Method "POST" -Path "/v1/channels/$voiceChannelId/voice/token" -Headers $bobAuth
$sw.Stop()
if (-not $bobForbiddenRes.Success -and $bobForbiddenRes.StatusCode -eq 403) {
    Record-Test "Non-Member Access Denied" $true "Returned 403 Forbidden as required" $sw.ElapsedMilliseconds
} else {
    Record-Test "Non-Member Access Denied" $false "Expected 403, got status $($bobForbiddenRes.StatusCode)" $sw.ElapsedMilliseconds
}

# 2.7 Alice requests voice token for TEXT channel -> Expect 400 Bad Request
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$textChanRes = Invoke-Api -Method "POST" -Path "/v1/channels/$textChannelId/voice/token" -Headers $aliceAuth
$sw.Stop()
if (-not $textChanRes.Success -and $textChanRes.StatusCode -eq 400) {
    Record-Test "Reject Non-Voice Channel Token" $true "Returned 400 INVALID_CHANNEL_TYPE for text channel" $sw.ElapsedMilliseconds
} else {
    Record-Test "Reject Non-Voice Channel Token" $false "Expected 400, got status $($textChanRes.StatusCode)" $sw.ElapsedMilliseconds
}

# 2.8 Request voice token for non-existent channel -> Expect 404 Not Found
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$notFoundRes = Invoke-Api -Method "POST" -Path "/v1/channels/999999999999999999/voice/token" -Headers $aliceAuth
$sw.Stop()
if (-not $notFoundRes.Success -and $notFoundRes.StatusCode -eq 404) {
    Record-Test "Channel Not Found Rejection" $true "Returned 404 CHANNEL_NOT_FOUND" $sw.ElapsedMilliseconds
} else {
    Record-Test "Channel Not Found Rejection" $false "Expected 404, got status $($notFoundRes.StatusCode)" $sw.ElapsedMilliseconds
}

# ==============================================================================
# TIER 3: Frontend TypeScript & Vite Production Build
# ==============================================================================
Log-Header "TIER 3: Frontend Client Production Build Verification"

if (-not $SkipFrontendBuild) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $ClientDir
    $prevEA = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        Write-Host "  Executing npm run build (tsc && vite build with livekit-client & voice components)..." -ForegroundColor Yellow
        $output = & cmd /c "npm run build"
        $exitCode = $LASTEXITCODE
        $sw.Stop()
        if ($exitCode -eq 0) {
            Record-Test "Frontend Production Build" $true "Vite & TypeScript compiled cleanly with 0 errors" $sw.ElapsedMilliseconds
        } else {
            Record-Test "Frontend Production Build" $false "Build error: exit code $exitCode" $sw.ElapsedMilliseconds
        }
    } catch {
        $sw.Stop()
        Record-Test "Frontend Production Build" $false $_.Message $sw.ElapsedMilliseconds
    } finally {
        $ErrorActionPreference = $prevEA
        Pop-Location
    }
}

# ==============================================================================
# Final Summary
# ==============================================================================
$GlobalStartTime.Stop()
Log-Header "Milestone 4 Verification Results"

$passedCount = ($Results | Where-Object { $_.Status -eq "PASS" }).Count
$totalCount = $Results.Count

Write-Host ""
Write-Host "  Total Tests: $totalCount | Passed: $passedCount | Failed: ($($totalCount - $passedCount)) | Total Elapsed: $($GlobalStartTime.ElapsedMilliseconds)ms" -ForegroundColor Cyan
Write-Host ""

if ($passedCount -eq $totalCount) {
    Write-Host "  >>> MILESTONE 4 VICTORY: ALL TESTS PASSED SUCCESSFULLY! <<<" -ForegroundColor Green
    exit 0
} else {
    Write-Host "  >>> MILESTONE 4 INCOMPLETE: SOME TESTS FAILED <<<" -ForegroundColor Red
    exit 1
}
