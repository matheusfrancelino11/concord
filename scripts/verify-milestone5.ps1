# ==============================================================================
# Concord — Milestone 5 Automated Verification Suite
# Screen Sharing, Voice State self_stream, ScreenShareView & Theater Controls
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

function Read-WebSocketEnvelope {
    param(
        [Parameter(Mandatory = $true)]
        [System.Net.WebSockets.ClientWebSocket]$ws,
        [int]$TimeoutMs = 5000
    )
    $cts = [System.Threading.CancellationTokenSource]::new($TimeoutMs)
    $buffer = [byte[]]::new(16384)
    $ms = [System.IO.MemoryStream]::new()
    try {
        while ($true) {
            $seg = [System.ArraySegment[byte]]::new($buffer)
            $task = $ws.ReceiveAsync($seg, $cts.Token)
            $task.Wait()
            $result = $task.Result
            if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
                return [PSCustomObject]@{
                    IsClose          = $true
                    CloseStatus      = [int]$result.CloseStatus
                    CloseDescription = $result.CloseStatusDescription
                    RawJson          = $null
                    Envelope         = $null
                }
            }
            $ms.Write($buffer, 0, $result.Count)
            if ($result.EndOfMessage) {
                break
            }
        }
        $jsonStr = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
        $env = $jsonStr | ConvertFrom-Json
        return [PSCustomObject]@{
            IsClose          = $false
            CloseStatus      = 0
            CloseDescription = ""
            RawJson          = $jsonStr
            Envelope         = $env
        }
    } finally {
        $ms.Dispose()
        $cts.Dispose()
    }
}

function Send-WebSocketEnvelope {
    param(
        [Parameter(Mandatory = $true)]
        [System.Net.WebSockets.ClientWebSocket]$ws,
        [Parameter(Mandatory = $true)]
        [hashtable]$Payload,
        [int]$TimeoutMs = 5000
    )
    $cts = [System.Threading.CancellationTokenSource]::new($TimeoutMs)
    try {
        $json = $Payload | ConvertTo-Json -Compress -Depth 10
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $seg = [System.ArraySegment[byte]]::new($bytes)
        $task = $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token)
        $task.Wait()
    } finally {
        $cts.Dispose()
    }
}

function Wait-ForWebSocketEvent {
    param(
        [Parameter(Mandatory = $true)]
        [System.Net.WebSockets.ClientWebSocket]$ws,
        [Parameter(Mandatory = $true)]
        [string]$ExpectedEventName,
        [int]$TimeoutMs = 5000
    )
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $TimeoutMs) {
        $remaining = [int]($TimeoutMs - $sw.ElapsedMilliseconds)
        if ($remaining -le 0) { break }
        try {
            $msg = Read-WebSocketEnvelope -ws $ws -TimeoutMs $remaining
        } catch {
            break
        }
        if ($msg.IsClose) {
            return [PSCustomObject]@{
                Success = $false
                Error   = "WebSocket closed prematurely with status $($msg.CloseStatus): $($msg.CloseDescription)"
                Data    = $null
                Raw     = $null
            }
        }
        $env = $msg.Envelope
        if ($env -and $env.op -eq 0 -and $env.t -eq $ExpectedEventName) {
            return [PSCustomObject]@{
                Success = $true
                Error   = $null
                Data    = $env.d
                Raw     = $msg.RawJson
            }
        }
    }
    return [PSCustomObject]@{
        Success = $false
        Error   = "Timed out waiting for event $ExpectedEventName"
        Data    = $null
        Raw     = $null
    }
}

# ==============================================================================
# TIER 1: Go Backend Automated Test Suite (Milestone 5)
# ==============================================================================
Log-Header "TIER 1: Backend Automated Test Harness (Milestone 5)"

if (-not $SkipBackendTests) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $ConcordDir
    try {
        Write-Host "  Running Milestone 5 Go Tests (Screen Share Voice State & Gateway Broadcast)..." -ForegroundColor Yellow
        $output = & go test -v -run TestMilestone5 ./tests/... 2>&1
        $exitCode = $LASTEXITCODE
        $sw.Stop()
        if ($exitCode -eq 0) {
            Record-Test "Backend Milestone 5 Go Tests" $true "Gateway Opcode 4 self_stream transitions and DB persistence passed cleanly" $sw.ElapsedMilliseconds
        } else {
            $errSnippet = ($output | Out-String).Trim()
            Record-Test "Backend Milestone 5 Go Tests" $false "Go test failed: $errSnippet" $sw.ElapsedMilliseconds
        }
    } catch {
        $sw.Stop()
        Record-Test "Backend Milestone 5 Go Tests" $false $_.Message $sw.ElapsedMilliseconds
    } finally {
        Pop-Location
    }
}

# ==============================================================================
# TIER 2: Live API & Real-Time Gateway Screen Share Verification
# ==============================================================================
Log-Header "TIER 2: Live Gateway Screen Share Transitions"

$unique = [System.DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

# 2.1 Backend Health
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$healthRes = Invoke-Api -Method "GET" -Path "/v1/health"
$sw.Stop()
if ($healthRes.Success -and $healthRes.Data.status -eq "ok") {
    Record-Test "Backend Healthcheck" $true "DB Status: healthy" $sw.ElapsedMilliseconds
} else {
    Record-Test "Backend Healthcheck" $false "Failed: $($healthRes.Error)" $sw.ElapsedMilliseconds
}

# 2.2 Register Alice & Bob
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$aliceRes = Invoke-Api -Method "POST" -Path "/v1/auth/register" -Body @{
    username = "m5_alice_$unique"
    email    = "m5_alice_$unique@test.com"
    password = "Password123!"
}
$bobRes = Invoke-Api -Method "POST" -Path "/v1/auth/register" -Body @{
    username = "m5_bob_$unique"
    email    = "m5_bob_$unique@test.com"
    password = "Password123!"
}
$sw.Stop()

$aliceToken = if ($aliceRes.Success) { $aliceRes.Data.token } else { $null }
$bobToken = if ($bobRes.Success) { $bobRes.Data.token } else { $null }
$aliceAuth = @{ "Authorization" = "Bearer $aliceToken" }
$bobAuth = @{ "Authorization" = "Bearer $bobToken" }

if ($aliceToken -and $bobToken) {
    Record-Test "Register Alice & Bob" $true "Alice ID: $($aliceRes.Data.user.id) | Bob ID: $($bobRes.Data.user.id)" $sw.ElapsedMilliseconds
} else {
    Record-Test "Register Alice & Bob" $false "Registration failed: Alice: $($aliceRes.Error) | Bob: $($bobRes.Error)" $sw.ElapsedMilliseconds
}

# 2.3 Alice creates guild and invites Bob
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$guildRes = Invoke-Api -Method "POST" -Path "/v1/guilds" -Headers $aliceAuth -Body @{
    name = "Milestone 5 Stream Guild"
}
$guildId = $guildRes.Data.id

$invRes = Invoke-Api -Method "POST" -Path "/v1/guilds/$guildId/invites" -Headers $aliceAuth
$invCode = $invRes.Data.code

$joinRes = Invoke-Api -Method "POST" -Path "/v1/invites/$invCode/use" -Headers $bobAuth
$sw.Stop()

if ($guildId -and $invCode -and $joinRes.Success) {
    Record-Test "Create Guild & Join Bob" $true "Guild ID: $guildId, Code: $invCode" $sw.ElapsedMilliseconds
} else {
    Record-Test "Create Guild & Join Bob" $false "Failed setting up guild/invite" $sw.ElapsedMilliseconds
}

# 2.4 Alice creates Voice Channel
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$voiceChanRes = Invoke-Api -Method "POST" -Path "/v1/guilds/$guildId/channels" -Headers $aliceAuth -Body @{
    name = "Screen Stream Lounge"
    type = 2
}
$sw.Stop()
$voiceChannelId = $voiceChanRes.Data.id
if ($voiceChanRes.Success -and $voiceChannelId) {
    Record-Test "Create Voice Channel" $true "Voice Channel ID: $voiceChannelId" $sw.ElapsedMilliseconds
} else {
    Record-Test "Create Voice Channel" $false "Failed: $($voiceChanRes.Error)" $sw.ElapsedMilliseconds
}

# 2.5 Real-Time Gateway Screen Share Verification using WebSocket
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
    # Initialize .NET ClientWebSocket instances
    $wsAlice = [System.Net.WebSockets.ClientWebSocket]::new()
    $wsBob = [System.Net.WebSockets.ClientWebSocket]::new()
    $wsUri = [System.Uri]::new("$WsBaseUrl/v1/gateway")

    # Connect Bob
    $ctsConnectBob = [System.Threading.CancellationTokenSource]::new(5000)
    $wsBob.ConnectAsync($wsUri, $ctsConnectBob.Token).Wait()
    $ctsConnectBob.Dispose()

    $null = Read-WebSocketEnvelope -ws $wsBob -TimeoutMs 5000 # Consume HELLO
    Send-WebSocketEnvelope -ws $wsBob -Payload @{ op = 2; d = @{ token = $bobToken } }
    $null = Read-WebSocketEnvelope -ws $wsBob -TimeoutMs 5000 # Consume READY
    $null = Read-WebSocketEnvelope -ws $wsBob -TimeoutMs 5000 # Consume GUILD_CREATE

    # Connect Alice
    $ctsConnectAlice = [System.Threading.CancellationTokenSource]::new(5000)
    $wsAlice.ConnectAsync($wsUri, $ctsConnectAlice.Token).Wait()
    $ctsConnectAlice.Dispose()

    $null = Read-WebSocketEnvelope -ws $wsAlice -TimeoutMs 5000 # Consume HELLO
    Send-WebSocketEnvelope -ws $wsAlice -Payload @{ op = 2; d = @{ token = $aliceToken } }
    $null = Read-WebSocketEnvelope -ws $wsAlice -TimeoutMs 5000 # Consume READY
    $null = Read-WebSocketEnvelope -ws $wsAlice -TimeoutMs 5000 # Consume GUILD_CREATE

    # Alice joins voice and starts screen share: Opcode 4 with self_stream = true
    Send-WebSocketEnvelope -ws $wsAlice -Payload @{
        op = 4
        d = @{
            guild_id = $guildId
            channel_id = $voiceChannelId
            self_mute = $false
            self_deaf = $false
            self_stream = $true
        }
    }

    # Bob waits for VOICE_STATE_UPDATE where self_stream is true
    $vsStartEvent = Wait-ForWebSocketEvent -ws $wsBob -ExpectedEventName "VOICE_STATE_UPDATE" -TimeoutMs 5000
    $receivedStreamStart = ($vsStartEvent.Success -and $vsStartEvent.Data.self_stream -eq $true)

    # Alice stops screen share: Opcode 4 with self_stream = false
    Send-WebSocketEnvelope -ws $wsAlice -Payload @{
        op = 4
        d = @{
            guild_id = $guildId
            channel_id = $voiceChannelId
            self_mute = $false
            self_deaf = $false
            self_stream = $false
        }
    }

    # Bob waits for VOICE_STATE_UPDATE where self_stream is false
    $vsStopEvent = Wait-ForWebSocketEvent -ws $wsBob -ExpectedEventName "VOICE_STATE_UPDATE" -TimeoutMs 5000
    $receivedStreamStop = ($vsStopEvent.Success -and $vsStopEvent.Data.self_stream -eq $false)

    try { $wsAlice.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "Done", [System.Threading.CancellationToken]::None).Wait() } catch {}
    try { $wsBob.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "Done", [System.Threading.CancellationToken]::None).Wait() } catch {}

    $sw.Stop()

    if ($receivedStreamStart -and $receivedStreamStop) {
        Record-Test "Live Gateway Screen Share Transitions" $true "Alice self_stream true/false broadcasts delivered to Bob" $sw.ElapsedMilliseconds
    } else {
        Record-Test "Live Gateway Screen Share Transitions" $false "Stream transitions mismatch: start=$receivedStreamStart stop=$receivedStreamStop (Error: $($vsStartEvent.Error) / $($vsStopEvent.Error))" $sw.ElapsedMilliseconds
    }
} catch {
    $sw.Stop()
    Record-Test "Live Gateway Screen Share Transitions" $false "WebSocket error: $($_.Exception.Message)" $sw.ElapsedMilliseconds
}

# ==============================================================================
# TIER 3: Frontend Client Production Build Verification
# ==============================================================================
Log-Header "TIER 3: Frontend Client Production Build Verification"

if (-not $SkipFrontendBuild) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $ClientDir
    $prevEA = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        Write-Host "  Executing npm run build (tsc && vite build with ScreenShareView & Theater components)..." -ForegroundColor Yellow
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
Log-Header "Milestone 5 Verification Results"

$passedCount = ($Results | Where-Object { $_.Status -eq "PASS" }).Count
$totalCount = $Results.Count

Write-Host ""
Write-Host "  Total Tests: $totalCount | Passed: $passedCount | Failed: ($($totalCount - $passedCount)) | Total Elapsed: $($GlobalStartTime.ElapsedMilliseconds)ms" -ForegroundColor Cyan
Write-Host ""

if ($passedCount -eq $totalCount) {
    Write-Host "  >>> MILESTONE 5 VICTORY: ALL TESTS PASSED SUCCESSFULLY! <<<" -ForegroundColor Green
    exit 0
} else {
    Write-Host "  >>> MILESTONE 5 INCOMPLETE: SOME TESTS FAILED <<<" -ForegroundColor Red
    exit 1
}
