# ==============================================================================
# Concord — Milestone 1 Automated Verification Suite
# Comprehensive E2E Verification Runner (Backend, Live HTTP, Frontend Build)
# ==============================================================================

[CmdletBinding()]
param(
    [int]$Port = 8085,
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
$ServerExe = Join-Path $ConcordDir "concord-server.exe"
$ServerLog = Join-Path $ScriptDir "concord-test-server.log"
$ServerErrLog = Join-Path $ScriptDir "concord-test-server-err.log"
$BaseUrl = "http://localhost:$Port"

# Results tracking
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
        Step        = $Results.Count + 1
        TestName    = $Name
        Status      = $statusStr
        Details     = $Details
        Duration    = $timeStr
        Success     = $Success
    })
}

# ==============================================================================
# STEP 1: Execute Go Backend Test Suite
# ==============================================================================
Log-Header "STEP 1: Go Backend Test Suite (cd concord && go test -v -count=1 ./...)"

if (-not $SkipBackendTests) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $ConcordDir
    try {
        Write-Host "Running: go test -v -count=1 ./..." -ForegroundColor Gray
        $testOutput = & go test -v -count=1 ./... 2>&1
        $exitCode = $LASTEXITCODE
        $sw.Stop()

        # Check for PASS marker
        $passCount = ($testOutput | Select-String "--- PASS:").Count
        $isSuccess = ($exitCode -eq 0) -and ($passCount -gt 0)

        if ($isSuccess) {
            Record-Test "Go Unit & Integration Test Suite" $true "All $passCount test scenarios passed successfully" $sw.ElapsedMilliseconds
        } else {
            $lastLines = ($testOutput | Select-Object -Last 10) -join "`n"
            Record-Test "Go Unit & Integration Test Suite" $false "Failed with exit code $exitCode`n$lastLines" $sw.ElapsedMilliseconds
            throw "Go test suite execution failed."
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "  [SKIPPED] Backend unit tests skipped via switch" -ForegroundColor Yellow
}

# ==============================================================================
# STEP 2: Build Server Binary & Launch Test Instance
# ==============================================================================
Log-Header "STEP 2: Build Server Binary & Launch on Test Port $Port"

$serverProcess = $null
$sw = [System.Diagnostics.Stopwatch]::StartNew()

try {
    Push-Location $ConcordDir
    Write-Host "Building server binary: go build -o concord-server.exe ./cmd/server" -ForegroundColor Gray
    $buildOutput = & go build -o concord-server.exe ./cmd/server 2>&1
    if ($LASTEXITCODE -ne 0) {
        $sw.Stop()
        Record-Test "Compile Backend Binary" $false "Compilation failed: $buildOutput" $sw.ElapsedMilliseconds
        throw "Failed to compile concord-server.exe"
    }
    $sw.Stop()
    Record-Test "Compile Backend Binary" $true "Binary concord-server.exe created successfully" $sw.ElapsedMilliseconds
} finally {
    Pop-Location
}

# Start server process with test PORT environment variable
Write-Host "Launching server on port $Port (stdout -> $ServerLog, stderr -> $ServerErrLog)..." -ForegroundColor Gray
$env:PORT = $Port.ToString()
$serverProcess = Start-Process -FilePath $ServerExe -WorkingDirectory $ConcordDir -RedirectStandardOutput $ServerLog -RedirectStandardError $ServerErrLog -PassThru -NoNewWindow

# Poll /health until server responds or timeout (15 seconds)
$serverReady = $false
$pollStart = [System.Diagnostics.Stopwatch]::StartNew()
while ($pollStart.ElapsedMilliseconds -lt 15000) {
    if ($serverProcess.HasExited) {
        break
    }
    try {
        $hRes = Invoke-RestMethod -Uri "$BaseUrl/health" -Method Get -TimeoutSec 1 -UseBasicParsing
        if ($hRes.status -eq "ok" -and $hRes.db -eq "healthy") {
            $serverReady = $true
            break
        }
    } catch {
        Start-Sleep -Milliseconds 250
    }
}
$pollStart.Stop()

if (-not $serverReady) {
    Record-Test "Server Startup & Health Ping" $false "Server did not become healthy within 15s" $pollStart.ElapsedMilliseconds
    if ($serverProcess -and -not $serverProcess.HasExited) {
        $serverProcess.Kill()
    }
    throw "Server startup timed out or failed. Check $ServerLog for details."
}

Record-Test "Server Startup & Health Ping" $true "Server listening on port $Port and reporting healthy" $pollStart.ElapsedMilliseconds

# ==============================================================================
# STEP 3: Execute Live HTTP Integration Checks using Invoke-RestMethod
# ==============================================================================
Log-Header "STEP 3: Live HTTP REST API Integration Verification"

try {
    $uniqueId = [System.IO.Path]::GetRandomFileName().Substring(0, 7)
    $aliceEmail = "alice_${uniqueId}@example.com"
    $aliceUsername = "alice_${uniqueId}"
    $alicePassword = "Password123!"
    $aliceToken = ""
    $aliceRefreshToken = ""
    $aliceUserId = ""

    # Test 3.1: Health check endpoints (/health and /v1/health)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $hRoot = Invoke-RestMethod -Uri "$BaseUrl/health" -Method Get -UseBasicParsing
        $hV1 = Invoke-RestMethod -Uri "$BaseUrl/v1/health" -Method Get -UseBasicParsing
        $ok = ($hRoot.status -eq "ok") -and ($hRoot.db -eq "healthy") -and ($hV1.status -eq "ok") -and ($hV1.db -eq "healthy")
        $sw.Stop()
        Record-Test "Health Checks (/health & /v1/health)" $ok "Status ok, db healthy on both routes" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Health Checks (/health & /v1/health)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # Test 3.2: User Registration (POST /v1/auth/register)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $regBody = @{
            email = $aliceEmail
            username = $aliceUsername
            password = $alicePassword
        } | ConvertTo-Json -Compress

        $regRes = Invoke-RestMethod -Uri "$BaseUrl/v1/auth/register" -Method Post -Body $regBody -ContentType "application/json" -UseBasicParsing
        $aliceToken = $regRes.token
        $aliceRefreshToken = $regRes.refresh_token
        $aliceUserId = "$($regRes.user.id)"

        $hasUser = ($null -ne $regRes.user) -and ($regRes.user.email -eq $aliceEmail) -and ($regRes.user.username -eq $aliceUsername)
        $hasSnowflake = ($aliceUserId.Length -ge 15)
        $hasTokens = ($aliceToken.Length -gt 20) -and ($aliceRefreshToken.Length -gt 20)
        $valid = $hasUser -and $hasSnowflake -and $hasTokens

        $sw.Stop()
        Record-Test "Register New User (POST /v1/auth/register)" $valid "User ID $aliceUserId, Access & Refresh JWTs returned" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Register New User (POST /v1/auth/register)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # Test 3.3: Duplicate Registration (POST /v1/auth/register -> 409 Conflict)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $null = Invoke-RestMethod -Uri "$BaseUrl/v1/auth/register" -Method Post -Body $regBody -ContentType "application/json" -UseBasicParsing
        $sw.Stop()
        Record-Test "Duplicate Register (409 Conflict)" $false "Expected 409 Conflict, but request succeeded" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        $statusCode = [int]$_.Exception.Response.StatusCode
        $isConflict = ($statusCode -eq 409)
        Record-Test "Duplicate Register (409 Conflict)" $isConflict "Server rejected duplicate registration with HTTP $statusCode" $sw.ElapsedMilliseconds
    }

    # Test 3.4: Weak Password Registration (< 8 chars -> 400 Bad Request)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $weakBody = @{
            email = "weak_${uniqueId}@example.com"
            username = "weak_${uniqueId}"
            password = "123"
        } | ConvertTo-Json -Compress
        $null = Invoke-RestMethod -Uri "$BaseUrl/v1/auth/register" -Method Post -Body $weakBody -ContentType "application/json" -UseBasicParsing
        $sw.Stop()
        Record-Test "Invalid Password Register (400 Bad Request)" $false "Expected 400 Bad Request on < 8 chars, but request succeeded" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        $statusCode = [int]$_.Exception.Response.StatusCode
        $isBadRequest = ($statusCode -eq 400)
        Record-Test "Invalid Password Register (400 Bad Request)" $isBadRequest "Server rejected short password (< 8 chars) with HTTP $statusCode" $sw.ElapsedMilliseconds
    }

    # Test 3.5: User Login (POST /v1/auth/login)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $loginBody = @{
            email = $aliceEmail
            password = $alicePassword
        } | ConvertTo-Json -Compress
        $loginRes = Invoke-RestMethod -Uri "$BaseUrl/v1/auth/login" -Method Post -Body $loginBody -ContentType "application/json" -UseBasicParsing
        $loginValid = ($loginRes.token.Length -gt 20) -and ($loginRes.user.email -eq $aliceEmail)
        $sw.Stop()
        Record-Test "User Login Valid Credentials (POST /v1/auth/login)" $loginValid "200 OK, valid credentials returned tokens" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "User Login Valid Credentials (POST /v1/auth/login)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # Test 3.6: User Login Bad Password (401 Unauthorized)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $badLoginBody = @{
            email = $aliceEmail
            password = "IncorrectPassword999!"
        } | ConvertTo-Json -Compress
        $null = Invoke-RestMethod -Uri "$BaseUrl/v1/auth/login" -Method Post -Body $badLoginBody -ContentType "application/json" -UseBasicParsing
        $sw.Stop()
        Record-Test "User Login Bad Password (401 Unauthorized)" $false "Expected 401 Unauthorized, but request succeeded" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        $statusCode = [int]$_.Exception.Response.StatusCode
        $isUnauthorized = ($statusCode -eq 401)
        Record-Test "User Login Bad Password (401 Unauthorized)" $isUnauthorized "Server rejected bad password with HTTP $statusCode" $sw.ElapsedMilliseconds
    }

    # Test 3.7: Token Refresh (POST /v1/auth/refresh)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $refreshBody = @{
            refresh_token = $aliceRefreshToken
        } | ConvertTo-Json -Compress
        $refreshRes = Invoke-RestMethod -Uri "$BaseUrl/v1/auth/refresh" -Method Post -Body $refreshBody -ContentType "application/json" -UseBasicParsing
        $newAccessToken = $refreshRes.token
        $refreshValid = ($newAccessToken.Length -gt 20)
        if ($refreshValid) { $aliceToken = $newAccessToken }
        $sw.Stop()
        Record-Test "Token Refresh (POST /v1/auth/refresh)" $refreshValid "200 OK, issued new valid access token" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Token Refresh (POST /v1/auth/refresh)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # Test 3.8: Authenticated User Profile (GET /v1/auth/me)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $authHeaders = @{ Authorization = "Bearer $aliceToken" }
        $meRes = Invoke-RestMethod -Uri "$BaseUrl/v1/auth/me" -Method Get -Headers $authHeaders -UseBasicParsing
        $meValid = ($meRes.user.email -eq $aliceEmail) -and ("$($meRes.user.id)" -eq $aliceUserId)
        $sw.Stop()
        Record-Test "User Profile Authenticated (GET /v1/auth/me)" $meValid "200 OK, retrieved user profile ($aliceEmail)" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "User Profile Authenticated (GET /v1/auth/me)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # Test 3.9: User Profile Without Token (401 Unauthorized)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $null = Invoke-RestMethod -Uri "$BaseUrl/v1/auth/me" -Method Get -UseBasicParsing
        $sw.Stop()
        Record-Test "User Profile Without Token (401 Unauthorized)" $false "Expected 401 Unauthorized without token" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        $statusCode = [int]$_.Exception.Response.StatusCode
        $isUnauthorized = ($statusCode -eq 401)
        Record-Test "User Profile Without Token (401 Unauthorized)" $isUnauthorized "Rejected unauthenticated request with HTTP $statusCode" $sw.ElapsedMilliseconds
    }

    # Test 3.10: User Profile With Bad Token (401 Unauthorized)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $badAuthHeaders = @{ Authorization = "Bearer invalid.fake.jwt" }
        $null = Invoke-RestMethod -Uri "$BaseUrl/v1/auth/me" -Method Get -Headers $badAuthHeaders -UseBasicParsing
        $sw.Stop()
        Record-Test "User Profile With Invalid Token (401 Unauthorized)" $false "Expected 401 with invalid token" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        $statusCode = [int]$_.Exception.Response.StatusCode
        $isUnauthorized = ($statusCode -eq 401)
        Record-Test "User Profile With Invalid Token (401 Unauthorized)" $isUnauthorized "Rejected invalid JWT token with HTTP $statusCode" $sw.ElapsedMilliseconds
    }

    # Test 3.11: Create Guild (POST /v1/guilds)
    $guildId = ""
    $defaultChannelId = ""
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $createGuildBody = @{
            name = "Verif Server $uniqueId"
        } | ConvertTo-Json -Compress
        $guildRes = Invoke-RestMethod -Uri "$BaseUrl/v1/guilds" -Method Post -Headers $authHeaders -Body $createGuildBody -ContentType "application/json" -UseBasicParsing
        $guildId = "$($guildRes.id)"
        $hasId = ($guildId.Length -ge 15)
        $hasOwner = ("$($guildRes.owner_id)" -eq $aliceUserId)

        # Verify auto-created @everyone role
        $everyoneRole = $guildRes.roles | Where-Object { $_.name -eq "@everyone" } | Select-Object -First 1
        $roleValid = ($null -ne $everyoneRole) -and ($everyoneRole.position -eq 0)

        # Verify auto-created #geral text channel
        $geralChannel = $guildRes.channels | Where-Object { $_.name -eq "geral" } | Select-Object -First 1
        $defaultChannelId = "$($geralChannel.id)"
        $channelValid = ($null -ne $geralChannel) -and ($geralChannel.type -eq 0) -and ($geralChannel.position -eq 0)

        $guildValid = $hasId -and $hasOwner -and $roleValid -and $channelValid
        $sw.Stop()
        Record-Test "Create Guild (POST /v1/guilds)" $guildValid "Auto-created @everyone (pos 0) & #geral (type 0, pos 0)" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Create Guild (POST /v1/guilds)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # Test 3.12: List User Guilds (GET /v1/guilds)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $guildsList = Invoke-RestMethod -Uri "$BaseUrl/v1/guilds" -Method Get -Headers $authHeaders -UseBasicParsing
        $found = $false
        foreach ($g in $guildsList) {
            if ("$($g.id)" -eq $guildId) { $found = $true; break }
        }
        $sw.Stop()
        Record-Test "List User Guilds (GET /v1/guilds)" $found "Guild $guildId present in user guild list" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "List User Guilds (GET /v1/guilds)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # Register Bob (Non-Member User) for permission testing
    $bobEmail = "bob_${uniqueId}@example.com"
    $bobBody = @{ email = $bobEmail; username = "bob_${uniqueId}"; password = "BobPassword123!" } | ConvertTo-Json -Compress
    $bobRes = Invoke-RestMethod -Uri "$BaseUrl/v1/auth/register" -Method Post -Body $bobBody -ContentType "application/json" -UseBasicParsing
    $bobHeaders = @{ Authorization = "Bearer $($bobRes.token)" }

    # Test 3.13: Guild Details (GET /v1/guilds/:id) & 403 for Non-Member
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        # Alice fetches guild details -> 200 OK
        $gDetails = Invoke-RestMethod -Uri "$BaseUrl/v1/guilds/$guildId" -Method Get -Headers $authHeaders -UseBasicParsing
        $aliceOk = ($gDetails.channels.Count -ge 1) -and ($gDetails.roles.Count -ge 1)

        # Bob fetches Alice's guild details -> 403 Forbidden
        $bobBlocked = $false
        try {
            $null = Invoke-RestMethod -Uri "$BaseUrl/v1/guilds/$guildId" -Method Get -Headers $bobHeaders -UseBasicParsing
        } catch {
            $bobCode = [int]$_.Exception.Response.StatusCode
            if ($bobCode -eq 403) { $bobBlocked = $true }
        }

        $sw.Stop()
        Record-Test "Guild Details & Non-Member 403 (GET /v1/guilds/:id)" ($aliceOk -and $bobBlocked) "Channels & roles returned to member; 403 Forbidden to non-member" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Guild Details & Non-Member 403 (GET /v1/guilds/:id)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # Test 3.14: Create Custom Text Channel (POST /v1/guilds/:id/channels)
    $customTextChId = ""
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $textChBody = @{
            name = "Novidades e Avisos"
            type = 0
        } | ConvertTo-Json -Compress
        $textChRes = Invoke-RestMethod -Uri "$BaseUrl/v1/guilds/$guildId/channels" -Method Post -Headers $authHeaders -Body $textChBody -ContentType "application/json" -UseBasicParsing
        $customTextChId = "$($textChRes.id)"
        $textOk = ($textChRes.name -eq "novidades-e-avisos") -and ($textChRes.type -eq 0) -and ($textChRes.position -eq 1)
        $sw.Stop()
        Record-Test "Create Custom Text Channel" $textOk "Created text channel 'novidades-e-avisos' at position 1" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Create Custom Text Channel" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # Test 3.15: Create Custom Voice Channel (POST /v1/guilds/:id/channels)
    $customVoiceChId = ""
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $voiceChBody = @{
            name = "Sala de Voz"
            type = 2
            bitrate = 96000
        } | ConvertTo-Json -Compress
        $voiceChRes = Invoke-RestMethod -Uri "$BaseUrl/v1/guilds/$guildId/channels" -Method Post -Headers $authHeaders -Body $voiceChBody -ContentType "application/json" -UseBasicParsing
        $customVoiceChId = "$($voiceChRes.id)"
        $voiceOk = ($voiceChRes.name -eq "Sala de Voz") -and ($voiceChRes.type -eq 2) -and ($voiceChRes.bitrate -eq 96000) -and ($voiceChRes.position -eq 2)
        $sw.Stop()
        Record-Test "Create Custom Voice Channel" $voiceOk "Created voice channel 'Sala de Voz' (type 2, bitrate 96k, pos 2)" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Create Custom Voice Channel" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # Test 3.16: List Guild Channels (GET /v1/guilds/:id/channels)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $channelsList = Invoke-RestMethod -Uri "$BaseUrl/v1/guilds/$guildId/channels" -Method Get -Headers $authHeaders -UseBasicParsing
        $hasThree = ($channelsList.Count -eq 3)
        $sw.Stop()
        Record-Test "List Guild Channels (GET /v1/guilds/:id/channels)" $hasThree "Verified all 3 channels present (#geral, text, voice)" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "List Guild Channels (GET /v1/guilds/:id/channels)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # Test 3.17: Delete Custom Channel (DELETE /v1/channels/:id)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $null = Invoke-RestMethod -Uri "$BaseUrl/v1/channels/$customTextChId" -Method Delete -Headers $authHeaders -UseBasicParsing
        $sw.Stop()
        Record-Test "Delete Custom Channel (DELETE /v1/channels/:id)" $true "204 No Content, custom text channel deleted" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Delete Custom Channel (DELETE /v1/channels/:id)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # Test 3.18: Invariant - Prevent Deletion of Last Text Channel (DELETE /v1/channels/:id -> 400)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $null = Invoke-RestMethod -Uri "$BaseUrl/v1/channels/$defaultChannelId" -Method Delete -Headers $authHeaders -UseBasicParsing
        $sw.Stop()
        Record-Test "Last Text Channel Protection Invariant" $false "Expected rejection when deleting last text channel" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        $statusCode = [int]$_.Exception.Response.StatusCode
        $rawError = $_.ErrorDetails.Message
        $isBlocked = ($statusCode -eq 400) -and ($rawError -match "CANNOT_DELETE_LAST_CHANNEL")
        Record-Test "Last Text Channel Protection Invariant" $isBlocked "Rejected with HTTP 400 and CANNOT_DELETE_LAST_CHANNEL" $sw.ElapsedMilliseconds
    }

    # Test 3.19: Delete Guild Non-Owner Rejection (DELETE /v1/guilds/:id -> 403 Forbidden)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $null = Invoke-RestMethod -Uri "$BaseUrl/v1/guilds/$guildId" -Method Delete -Headers $bobHeaders -UseBasicParsing
        $sw.Stop()
        Record-Test "Delete Guild Non-Owner 403 Forbidden" $false "Expected 403 Forbidden when non-owner deletes guild" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        $statusCode = [int]$_.Exception.Response.StatusCode
        $isForbidden = ($statusCode -eq 403)
        Record-Test "Delete Guild Non-Owner 403 Forbidden" $isForbidden "Rejected unauthorized guild deletion with HTTP $statusCode" $sw.ElapsedMilliseconds
    }

    # Test 3.20: Delete Guild by Owner (DELETE /v1/guilds/:id -> 204 No Content)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $null = Invoke-RestMethod -Uri "$BaseUrl/v1/guilds/$guildId" -Method Delete -Headers $authHeaders -UseBasicParsing
        
        # Verify guild lookup now returns 404 Not Found
        $isGone = $false
        try {
            $null = Invoke-RestMethod -Uri "$BaseUrl/v1/guilds/$guildId" -Method Get -Headers $authHeaders -UseBasicParsing
        } catch {
            if ([int]$_.Exception.Response.StatusCode -eq 404) {
                $isGone = $true
            }
        }

        $sw.Stop()
        Record-Test "Delete Guild Owner & Verify 404" $isGone "Guild successfully deleted (204) and subsequent lookup returned 404" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Delete Guild Owner & Verify 404" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

} finally {
    # ==============================================================================
    # STEP 4: Gracefully Stop Background Server Process
    # ==============================================================================
    Log-Header "STEP 4: Graceful Shutdown of Background Server"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Write-Host "Stopping server process PID $($serverProcess.Id)..." -ForegroundColor Gray
        try {
            Stop-Process -Id $serverProcess.Id -Force
            [void]$serverProcess.WaitForExit(5000)
            $sw.Stop()
            Record-Test "Graceful Server Teardown" $true "Background server stopped cleanly" $sw.ElapsedMilliseconds
        } catch {
            $sw.Stop()
            Record-Test "Graceful Server Teardown" $false "Error stopping server: $($_.Exception.Message)" $sw.ElapsedMilliseconds
        }
    } else {
        $sw.Stop()
        Record-Test "Graceful Server Teardown" $true "Server process already exited" $sw.ElapsedMilliseconds
    }
}

# ==============================================================================
# STEP 5: Frontend Client Build Verification
# ==============================================================================
Log-Header "STEP 5: Frontend Build Verification (cd concord-client && npm run build)"

if (-not $SkipFrontendBuild) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $ClientDir
    try {
        Write-Host "Executing: npm run build in concord-client..." -ForegroundColor Gray
        $npmOutput = & cmd.exe /c "npm run build" 2>&1
        $npmExit = $LASTEXITCODE
        $distIndex = Join-Path $ClientDir "dist\index.html"
        $distExists = Test-Path $distIndex
        $sw.Stop()

        $frontendSuccess = ($npmExit -eq 0) -and $distExists
        if ($frontendSuccess) {
            Record-Test "Frontend Production Build (npm run build)" $true "TypeScript + Vite bundle built clean; dist/index.html verified" $sw.ElapsedMilliseconds
        } else {
            $lastLines = ($npmOutput | Select-Object -Last 10) -join "`n"
            Record-Test "Frontend Production Build (npm run build)" $false "Build failed with exit code $npmExit`n$lastLines" $sw.ElapsedMilliseconds
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "  [SKIPPED] Frontend build skipped via switch" -ForegroundColor Yellow
}

# ==============================================================================
# STEP 6: Pass / Fail Summary Table
# ==============================================================================
$GlobalStartTime.Stop()
Log-Header "STEP 6: Automated Verification Results Summary"

$passedCount = ($Results | Where-Object { $_.Success -eq $true }).Count
$failedCount = ($Results | Where-Object { $_.Success -eq $false }).Count
$totalCount = $Results.Count

Write-Host ""
$Results | Format-Table -Property Step, TestName, Status, Duration, Details -AutoSize

$summaryColor = if ($failedCount -eq 0) { "Green" } else { "Red" }
Write-Host ("-" * 80) -ForegroundColor Gray
Write-Host "TOTAL TESTS: $totalCount | PASSED: $passedCount | FAILED: $failedCount | DURATION: $($GlobalStartTime.Elapsed.ToString('mm\:ss\.fff'))" -ForegroundColor $summaryColor
Write-Host ("-" * 80) -ForegroundColor Gray
Write-Host ""

if ($failedCount -gt 0) {
    Write-Host "[FAIL] Verification suite encountered $failedCount failures." -ForegroundColor Red
    exit 1
} else {
    Write-Host "[PASS] All Milestone 1 verification stages executed successfully with ZERO failures!" -ForegroundColor Green
    exit 0
}
