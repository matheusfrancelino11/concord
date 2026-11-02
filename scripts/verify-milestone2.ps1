# ==============================================================================
# Concord — Milestone 2 Automated Verification Suite
# Comprehensive E2E Verification Runner (Backend, Live Gateway WebSocket & Fanout, Frontend Build)
# ==============================================================================

[CmdletBinding()]
param(
    [int]$Port = 8086,
    [switch]$SkipBackendTests = $false,
    [switch]$SkipFrontendBuild = $false,
    [switch]$SimulateFailure = $false
)

$ErrorActionPreference = "Stop"
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

# Resolve repository paths
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$ConcordDir = Join-Path $RepoRoot "concord"
$ClientDir = Join-Path $RepoRoot "concord-client"
$ServerExe = Join-Path $ConcordDir "concord-server.exe"
$ServerLog = Join-Path $ScriptDir "concord-m2-test-server.log"
$ServerErrLog = Join-Path $ScriptDir "concord-m2-test-server-err.log"
$BaseUrl = "http://localhost:$Port"
$WsBaseUrl = "ws://localhost:$Port"

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

function Test-PortAvailability {
    param(
        [Parameter(Mandatory = $true)]
        [int]$TestPort
    )

    # 1. Query NetTCPIP for active listeners with owning process identification
    try {
        $connections = Get-NetTCPConnection -LocalPort $TestPort -State Listen -ErrorAction SilentlyContinue
        if ($connections) {
            $pids = @($connections | ForEach-Object { $_.OwningProcess }) | Select-Object -Unique
            $procNames = @($pids | ForEach-Object {
                $proc = Get-Process -Id $_ -ErrorAction SilentlyContinue
                if ($proc) { "$($proc.ProcessName) (PID $_)" } else { "PID $_" }
            }) -join ", "
            return [PSCustomObject]@{
                InUse   = $true
                Details = "Port $TestPort is actively listened on by: $procNames"
            }
        }
    } catch {
        # Fall through to socket checks if Get-NetTCPConnection is restricted
    }

    # 2. Attempt exclusive bind on loopback interface (127.0.0.1)
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $TestPort)
        $listener.Server.ExclusiveAddressUse = $true
        $listener.Start()
        $listener.Stop()
    } catch {
        return [PSCustomObject]@{
            InUse   = $true
            Details = "Port $TestPort exclusive bind failed: $($_.Exception.Message)"
        }
    }

    # 3. Connection probe to loopback to catch wildcard listeners (0.0.0.0 / [::])
    try {
        $tcpClient = [System.Net.Sockets.TcpClient]::new()
        $connectTask = $tcpClient.ConnectAsync([System.Net.IPAddress]::Loopback, $TestPort)
        $connected = $connectTask.Wait(200) -and $tcpClient.Connected
        if ($connected) {
            $tcpClient.Close()
            $tcpClient.Dispose()
            return [PSCustomObject]@{
                InUse   = $true
                Details = "Port $TestPort responded to incoming connection probe"
            }
        }
        $tcpClient.Close()
        $tcpClient.Dispose()
    } catch {
        # Port connection refused or timed out as expected for an unoccupied port
    }

    return [PSCustomObject]@{
        InUse   = $false
        Details = "Port $TestPort is free"
    }
}

function Add-GuildMemberToDatabase {
    param(
        [Parameter(Mandatory = $true)]
        [string]$GuildId,
        [Parameter(Mandatory = $true)]
        [string]$UserId
    )
    $cmd = Get-Command psql.exe -ErrorAction SilentlyContinue
    $psql = if ($cmd) { $cmd.Source } else { $null }
    if (-not $psql) {
        $item = Get-Item "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue | Select-Object -Last 1
        if ($item) { $psql = $item.FullName }
    }
    if (-not $psql) {
        throw "psql.exe not found on system. Ensure PostgreSQL is installed."
    }

    $dbUser = "concord"
    $dbHost = "127.0.0.1"
    $dbPort = "5432"
    $dbName = "concord"
    $dbPass = "concord"
    if ($env:DATABASE_URL) {
        if ($env:DATABASE_URL -match "postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):?(\d+)?/(.+)") {
            $dbUser = $Matches[1]
            $dbPass = $Matches[2]
            $dbHost = $Matches[3]
            if ($Matches[4]) { $dbPort = $Matches[4] }
            $dbName = ($Matches[5] -split "\?")[0]
        }
    }
    $env:PGPASSWORD = $dbPass
    $sql = "INSERT INTO members (guild_id, user_id, joined_at) VALUES ($GuildId, $UserId, NOW()) ON CONFLICT DO NOTHING;"
    & $psql -U $dbUser -d $dbName -h $dbHost -p $dbPort -c $sql | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to execute member insert via psql. Exit code: $LASTEXITCODE"
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
        [int]$TimeoutMs = 3000
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
        Error   = "Timed out waiting for event $ExpectedEventName within ${TimeoutMs}ms"
        Data    = $null
        Raw     = $null
    }
}

# ==============================================================================
# STEP 1: Execute Go Backend Test Suite
# ==============================================================================
Log-Header "STEP 1: Go Backend Test Suite (cd concord && go test -v -count=1 ./tests/...)"

if (-not $SkipBackendTests) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $ConcordDir
    try {
        Write-Host "Running: go test -v -count=1 ./tests/..." -ForegroundColor Gray
        $testOutput = & go test -v -count=1 ./tests/... 2>&1
        $exitCode = $LASTEXITCODE
        $sw.Stop()

        # Count PASS markers
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

# ==============================================================================
# STEP 3: Pre-flight TCP Port Check
# ==============================================================================
Log-Header "STEP 3: Pre-flight TCP Port Check on Port $Port"
$swPort = [System.Diagnostics.Stopwatch]::StartNew()
Write-Host "Performing pre-flight TCP port check on port $Port..." -ForegroundColor Gray
$portStatus = Test-PortAvailability -TestPort $Port
$swPort.Stop()

if ($portStatus.InUse) {
    Record-Test "Pre-flight Port Check" $false "Pre-flight port collision detected: $($portStatus.Details)" $swPort.ElapsedMilliseconds
    throw "Pre-flight check failed: Port $Port is already in use ($($portStatus.Details)). Terminate conflicting listener or specify a different port with -Port <port>."
}
Record-Test "Pre-flight Port Check" $true "Port $Port is free and available" $swPort.ElapsedMilliseconds

# Sockets for cleanup in finally block
$wsAlice = $null
$wsBob = $null

# Outer try block guarantees process teardown and socket disposal in STEP 6 finally block
try {
    # Clean previous test server logs if present
    Remove-Item -Path $ServerLog, $ServerErrLog -Force -ErrorAction SilentlyContinue

    # ==============================================================================
    # STEP 4: Launch Server on Port $Port & Await Health Ping
    # ==============================================================================
    Log-Header "STEP 4: Launch Server on Port $Port & Await Health Ping"
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
                Start-Sleep -Milliseconds 100
                if (-not $serverProcess.HasExited) {
                    $serverReady = $true
                    break
                }
            }
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
    $pollStart.Stop()

    if (-not $serverReady) {
        $detailMsg = "Server did not become healthy within 15s"
        if ($serverProcess.HasExited) {
            $detailMsg = "Server process terminated prematurely with exit code $($serverProcess.ExitCode)"
        }
        if (Test-Path $ServerErrLog) {
            $errSnippet = (Get-Content $ServerErrLog -Tail 5 -ErrorAction SilentlyContinue) -join " "
            if ($errSnippet) {
                $detailMsg += " (stderr: $errSnippet)"
            }
        }
        Record-Test "Server Startup & Health Ping" $false $detailMsg $pollStart.ElapsedMilliseconds
        throw "Server startup timed out or failed. Check $ServerLog and $ServerErrLog for details."
    }

    Record-Test "Server Startup & Health Ping" $true "Server listening on port $Port and reporting healthy" $pollStart.ElapsedMilliseconds

    # ==============================================================================
    # STEP 5: Live End-to-End WebSocket Gateway and Message REST Verification
    # ==============================================================================
    Log-Header "STEP 5: Live E2E WebSocket Gateway and Message REST Verification"
    $uniqueId = [System.IO.Path]::GetRandomFileName().Substring(0, 7)

    # 5.1 Health checks
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

    # 5.2 User registration for User A (Alice) and User B (Bob)
    $aliceEmail = "alice_m2_${uniqueId}@example.com"
    $aliceUsername = "alice_m2_${uniqueId}"
    $alicePassword = "AlicePassword123!"
    $aliceToken = ""
    $aliceUserId = ""

    $bobEmail = "bob_m2_${uniqueId}@example.com"
    $bobUsername = "bob_m2_${uniqueId}"
    $bobPassword = "BobPassword123!"
    $bobToken = ""
    $bobUserId = ""

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $regAliceBody = @{ email = $aliceEmail; username = $aliceUsername; password = $alicePassword } | ConvertTo-Json -Compress
        $regAliceRes = Invoke-RestMethod -Uri "$BaseUrl/v1/auth/register" -Method Post -Body $regAliceBody -ContentType "application/json" -UseBasicParsing
        $aliceToken = $regAliceRes.token
        $aliceUserId = "$($regAliceRes.user.id)"

        $regBobBody = @{ email = $bobEmail; username = $bobUsername; password = $bobPassword } | ConvertTo-Json -Compress
        $regBobRes = Invoke-RestMethod -Uri "$BaseUrl/v1/auth/register" -Method Post -Body $regBobBody -ContentType "application/json" -UseBasicParsing
        $bobToken = $regBobRes.token
        $bobUserId = "$($regBobRes.user.id)"

        $regOk = ($aliceUserId.Length -ge 15) -and ($bobUserId.Length -ge 15) -and ($aliceToken.Length -gt 20) -and ($bobToken.Length -gt 20)
        $sw.Stop()
        Record-Test "User Registration (Alice & Bob)" $regOk "Registered Alice (ID $aliceUserId) and Bob (ID $bobUserId)" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "User Registration (Alice & Bob)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # 5.3 User login & JWT validation
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $loginAliceBody = @{ email = $aliceEmail; password = $alicePassword } | ConvertTo-Json -Compress
        $loginAliceRes = Invoke-RestMethod -Uri "$BaseUrl/v1/auth/login" -Method Post -Body $loginAliceBody -ContentType "application/json" -UseBasicParsing

        $loginBobBody = @{ email = $bobEmail; password = $bobPassword } | ConvertTo-Json -Compress
        $loginBobRes = Invoke-RestMethod -Uri "$BaseUrl/v1/auth/login" -Method Post -Body $loginBobBody -ContentType "application/json" -UseBasicParsing

        $loginOk = ($loginAliceRes.token.Length -gt 20) -and ($loginBobRes.token.Length -gt 20)
        $sw.Stop()
        Record-Test "User Login & JWT Validation (Alice & Bob)" $loginOk "200 OK, valid JWT credentials issued for both users" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "User Login & JWT Validation (Alice & Bob)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    $authHeadersAlice = @{ Authorization = "Bearer $aliceToken" }
    $authHeadersBob = @{ Authorization = "Bearer $bobToken" }

    # 5.4 User A creates Guild and default channels (#geral)
    $guildId = ""
    $geralChannelId = ""
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $createGuildBody = @{ name = "Concord M2 Guild $uniqueId" } | ConvertTo-Json -Compress
        $guildRes = Invoke-RestMethod -Uri "$BaseUrl/v1/guilds" -Method Post -Headers $authHeadersAlice -Body $createGuildBody -ContentType "application/json" -UseBasicParsing
        $guildId = "$($guildRes.id)"

        $geralChannel = $guildRes.channels | Where-Object { $_.name -eq "geral" } | Select-Object -First 1
        $geralChannelId = "$($geralChannel.id)"

        $guildOk = ($guildId.Length -ge 15) -and ($geralChannelId.Length -ge 15) -and ($geralChannel.type -eq 0)
        $sw.Stop()
        Record-Test "Create Guild (#geral default channel)" $guildOk "Guild $guildId created with #geral (ID $geralChannelId, type 0)" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Create Guild (#geral default channel)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # 5.5 User A creates custom text channel sala-de-bate-papo
    $chatChannelId = ""
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $createChannelBody = @{ name = "sala-de-bate-papo"; type = 0 } | ConvertTo-Json -Compress
        $chRes = Invoke-RestMethod -Uri "$BaseUrl/v1/guilds/$guildId/channels" -Method Post -Headers $authHeadersAlice -Body $createChannelBody -ContentType "application/json" -UseBasicParsing
        $chatChannelId = "$($chRes.id)"
        $chOk = ($chRes.name -eq "sala-de-bate-papo") -and ($chRes.type -eq 0) -and ($chatChannelId.Length -ge 15)
        $sw.Stop()
        Record-Test "Create Custom Text Channel (sala-de-bate-papo)" $chOk "Created custom channel '$($chRes.name)' (ID $chatChannelId)" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Create Custom Text Channel (sala-de-bate-papo)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # 5.6 Add Bob to Guild and verify membership
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Add-GuildMemberToDatabase -GuildId $guildId -UserId $bobUserId
        # Verify Bob can view guild details (which requires guild membership)
        $bobGuildView = Invoke-RestMethod -Uri "$BaseUrl/v1/guilds/$guildId" -Method Get -Headers $authHeadersBob -UseBasicParsing
        $memberOk = ($bobGuildView.id -eq $guildId) -and ($bobGuildView.channels.Count -ge 2)
        $sw.Stop()
        Record-Test "Add Bob to Guild & Membership Verification" $memberOk "Bob successfully added to guild; verified via GET /v1/guilds/:id" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Add Bob to Guild & Membership Verification" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # 5.7 WebSocket Gateway Handshake (Alice connects, receives HELLO Opcode 10)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $wsAlice = [System.Net.WebSockets.ClientWebSocket]::new()
        $connectUri = [System.Uri]::new("$WsBaseUrl/v1/gateway")
        $ctsConnect = [System.Threading.CancellationTokenSource]::new(5000)
        $wsAlice.ConnectAsync($connectUri, $ctsConnect.Token).Wait()
        $ctsConnect.Dispose()

        $helloEnv = Read-WebSocketEnvelope -ws $wsAlice -TimeoutMs 5000
        $helloOk = (-not $helloEnv.IsClose) -and ($helloEnv.Envelope.op -eq 10) -and ($helloEnv.Envelope.d.heartbeat_interval -eq 41250)
        $sw.Stop()
        Record-Test "WebSocket Gateway Handshake (Op 10 HELLO)" $helloOk "Received Opcode 10 HELLO with heartbeat_interval 41250" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "WebSocket Gateway Handshake (Op 10 HELLO)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # 5.8 WebSocket Gateway Auth Rejection (Send invalid token -> close code 4004)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Send-WebSocketEnvelope -ws $wsAlice -Payload @{ op = 2; d = @{ token = "invalid.untrusted.jwt.token" } }
        $badAuthEnv = Read-WebSocketEnvelope -ws $wsAlice -TimeoutMs 5000
        $code4004Ok = ($badAuthEnv.IsClose -and $badAuthEnv.CloseStatus -eq 4004)
        $sw.Stop()
        Record-Test "WebSocket Gateway Auth Rejection (Bad Token -> Code 4004)" $code4004Ok "Server closed connection with code 4004 (Authentication Failed)" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "WebSocket Gateway Auth Rejection (Bad Token -> Code 4004)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # 5.9 WebSocket Gateway Authentication (Alice reconnects, sends valid JWT, receives READY and GUILD_CREATE)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $wsAlice.Dispose()
        $wsAlice = [System.Net.WebSockets.ClientWebSocket]::new()
        $ctsConnect = [System.Threading.CancellationTokenSource]::new(5000)
        $wsAlice.ConnectAsync($connectUri, $ctsConnect.Token).Wait()
        $ctsConnect.Dispose()

        $null = Read-WebSocketEnvelope -ws $wsAlice -TimeoutMs 5000 # Consume HELLO

        # Send valid IDENTIFY
        Send-WebSocketEnvelope -ws $wsAlice -Payload @{ op = 2; d = @{ token = $aliceToken } }

        # Receive READY (Opcode 0, t: READY, s: 1)
        $readyMsg = Read-WebSocketEnvelope -ws $wsAlice -TimeoutMs 5000
        $readyEnv = $readyMsg.Envelope
        $readyOk = ($readyEnv.op -eq 0) -and ($readyEnv.t -eq "READY") -and ($readyEnv.s -eq 1) -and ($null -ne $readyEnv.d.session_id)

        # Receive GUILD_CREATE
        $guildCreateMsg = Read-WebSocketEnvelope -ws $wsAlice -TimeoutMs 5000
        $guildCreateEnv = $guildCreateMsg.Envelope
        $guildCreateOk = ($guildCreateEnv.op -eq 0) -and ($guildCreateEnv.t -eq "GUILD_CREATE") -and ("$($guildCreateEnv.d.id)" -eq $guildId)

        $authOk = $readyOk -and $guildCreateOk
        $sw.Stop()
        Record-Test "WebSocket Gateway Authentication (Op 2 IDENTIFY -> READY & GUILD_CREATE)" $authOk "Received Opcode 0 READY (session_id $($readyEnv.d.session_id)) and GUILD_CREATE for guild $guildId" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "WebSocket Gateway Authentication (Op 2 IDENTIFY -> READY & GUILD_CREATE)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # 5.10 WebSocket Heartbeat Ping/Pong (Op 1 HEARTBEAT -> Op 11 HEARTBEAT_ACK)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Send-WebSocketEnvelope -ws $wsAlice -Payload @{ op = 1; d = $null }
        $ackMsg = Read-WebSocketEnvelope -ws $wsAlice -TimeoutMs 5000
        $ackOk = ($ackMsg.Envelope.op -eq 11)
        $sw.Stop()
        Record-Test "WebSocket Heartbeat Ping/Pong (Op 1 HEARTBEAT -> Op 11 HEARTBEAT_ACK)" $ackOk "Sent Opcode 1 HEARTBEAT; received Opcode 11 HEARTBEAT_ACK" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "WebSocket Heartbeat Ping/Pong (Op 1 HEARTBEAT -> Op 11 HEARTBEAT_ACK)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # 5.11 Bob WebSocket Gateway Connection & Authentication
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $wsBob = [System.Net.WebSockets.ClientWebSocket]::new()
        $ctsConnectBob = [System.Threading.CancellationTokenSource]::new(5000)
        $wsBob.ConnectAsync($connectUri, $ctsConnectBob.Token).Wait()
        $ctsConnectBob.Dispose()

        $null = Read-WebSocketEnvelope -ws $wsBob -TimeoutMs 5000 # Consume HELLO

        Send-WebSocketEnvelope -ws $wsBob -Payload @{ op = 2; d = @{ token = $bobToken } }

        $bobReadyMsg = Read-WebSocketEnvelope -ws $wsBob -TimeoutMs 5000
        $bobGuildCreateMsg = Read-WebSocketEnvelope -ws $wsBob -TimeoutMs 5000

        $bobReadyOk = ($bobReadyMsg.Envelope.op -eq 0) -and ($bobReadyMsg.Envelope.t -eq "READY")
        $bobGuildOk = ($bobGuildCreateMsg.Envelope.op -eq 0) -and ($bobGuildCreateMsg.Envelope.t -eq "GUILD_CREATE") -and ("$($bobGuildCreateMsg.Envelope.d.id)" -eq $guildId)

        $bobConnectOk = $bobReadyOk -and $bobGuildOk
        $sw.Stop()
        Record-Test "Bob WebSocket Gateway Connection & Authentication" $bobConnectOk "Bob connected to Gateway, authenticated, received READY and entered Guild Hub" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Bob WebSocket Gateway Connection & Authentication" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # 5.12 Real-Time Message Broadcast (POST -> MESSAGE_CREATE to Bob within 2000ms)
    $msg1Id = ""
    $msg1Content = "Hello Bob! Welcome to sala-de-bate-papo."
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $postMsgBody = @{ content = $msg1Content } | ConvertTo-Json -Compress
        $postMsgRes = Invoke-RestMethod -Uri "$BaseUrl/v1/channels/$chatChannelId/messages" -Method Post -Headers $authHeadersAlice -Body $postMsgBody -ContentType "application/json" -UseBasicParsing
        $msg1Id = "$($postMsgRes.id)"

        # Bob receives MESSAGE_CREATE event over WebSocket within 2000ms
        $fanoutCreate = Wait-ForWebSocketEvent -ws $wsBob -ExpectedEventName "MESSAGE_CREATE" -TimeoutMs 2000
        $msgCreateOk = if ($SimulateFailure) { $false } else {
            $fanoutCreate.Success -and ("$($fanoutCreate.Data.id)" -eq $msg1Id) -and ($fanoutCreate.Data.content -eq $msg1Content) -and ("$($fanoutCreate.Data.channel_id)" -eq $chatChannelId)
        }
        $sw.Stop()
        $msgCreateDetail = if ($SimulateFailure) { "Simulated failure: MESSAGE_CREATE event verification failed" } else { "Bob received MESSAGE_CREATE for msg $msg1Id within 2000ms with verified payload" }
        Record-Test "Real-Time Message Broadcast (POST -> MESSAGE_CREATE to Bob within 2000ms)" $msgCreateOk $msgCreateDetail $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Real-Time Message Broadcast (POST -> MESSAGE_CREATE to Bob within 2000ms)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # 5.13 Real-Time Message Edit Broadcast (PATCH -> MESSAGE_UPDATE to Bob)
    $msg1UpdatedContent = "Hello Bob! Message edited successfully."
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $editBody = @{ content = $msg1UpdatedContent } | ConvertTo-Json -Compress
        $patchRes = Invoke-RestMethod -Uri "$BaseUrl/v1/channels/$chatChannelId/messages/$msg1Id" -Method Patch -Headers $authHeadersAlice -Body $editBody -ContentType "application/json" -UseBasicParsing

        $fanoutUpdate = Wait-ForWebSocketEvent -ws $wsBob -ExpectedEventName "MESSAGE_UPDATE" -TimeoutMs 2000
        $msgUpdateOk = $fanoutUpdate.Success -and ("$($fanoutUpdate.Data.id)" -eq $msg1Id) -and ($fanoutUpdate.Data.content -eq $msg1UpdatedContent) -and ($null -ne $fanoutUpdate.Data.edited_at)
        $sw.Stop()
        Record-Test "Real-Time Message Edit Broadcast (PATCH -> MESSAGE_UPDATE to Bob)" $msgUpdateOk "Bob received MESSAGE_UPDATE with updated content and edited_at timestamp" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Real-Time Message Edit Broadcast (PATCH -> MESSAGE_UPDATE to Bob)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # 5.14 Real-Time Ephemeral Typing Broadcast (POST /typing -> TYPING_START to Bob)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $null = Invoke-RestMethod -Uri "$BaseUrl/v1/channels/$chatChannelId/typing" -Method Post -Headers $authHeadersAlice -UseBasicParsing

        $fanoutTyping = Wait-ForWebSocketEvent -ws $wsBob -ExpectedEventName "TYPING_START" -TimeoutMs 2000
        $typingOk = $fanoutTyping.Success -and ("$($fanoutTyping.Data.channel_id)" -eq $chatChannelId) -and ("$($fanoutTyping.Data.guild_id)" -eq $guildId) -and ("$($fanoutTyping.Data.user_id)" -eq $aliceUserId)
        $sw.Stop()
        Record-Test "Real-Time Ephemeral Typing Broadcast (POST /typing -> TYPING_START to Bob)" $typingOk "Bob received TYPING_START (ephemeral broadcast without DB write)" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Real-Time Ephemeral Typing Broadcast (POST /typing -> TYPING_START to Bob)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # 5.15 Real-Time Message Delete Broadcast (DELETE -> MESSAGE_DELETE to Bob)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $null = Invoke-RestMethod -Uri "$BaseUrl/v1/channels/$chatChannelId/messages/$msg1Id" -Method Delete -Headers $authHeadersAlice -UseBasicParsing

        $fanoutDelete = Wait-ForWebSocketEvent -ws $wsBob -ExpectedEventName "MESSAGE_DELETE" -TimeoutMs 2000
        $delOk = $fanoutDelete.Success -and ("$($fanoutDelete.Data.id)" -eq $msg1Id) -and ("$($fanoutDelete.Data.channel_id)" -eq $chatChannelId)
        $sw.Stop()
        Record-Test "Real-Time Message Delete Broadcast (DELETE -> MESSAGE_DELETE to Bob)" $delOk "Bob received MESSAGE_DELETE for msg $msg1Id" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Real-Time Message Delete Broadcast (DELETE -> MESSAGE_DELETE to Bob)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # 5.16 Message Pagination & Chronological Ordering (?before=&limit=50)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $postedIds = [System.Collections.Generic.List[string]]::new()
        for ($i = 1; $i -le 5; $i++) {
            $pBody = @{ content = "Paging Test Message #$i ($uniqueId)" } | ConvertTo-Json -Compress
            $pRes = Invoke-RestMethod -Uri "$BaseUrl/v1/channels/$chatChannelId/messages" -Method Post -Headers $authHeadersAlice -Body $pBody -ContentType "application/json" -UseBasicParsing
            $postedIds.Add("$($pRes.id)")
        }

        # Fetch full page (should return all 5 messages in chronological order)
        $listAll = Invoke-RestMethod -Uri "$BaseUrl/v1/channels/$chatChannelId/messages?limit=50" -Method Get -Headers $authHeadersAlice -UseBasicParsing
        $isOrdered = $true
        if ($listAll.Count -ne 5) {
            $isOrdered = $false
        } else {
            for ($i = 0; $i -lt 5; $i++) {
                if ("$($listAll[$i].id)" -ne $postedIds[$i]) {
                    $isOrdered = $false
                    break
                }
            }
        }

        # Fetch with ?before=<id>&limit=2 (before message 4 -> should return messages 2 and 3)
        $msg4Id = $postedIds[3]
        $listBefore = Invoke-RestMethod -Uri "$BaseUrl/v1/channels/$chatChannelId/messages?before=$msg4Id&limit=2" -Method Get -Headers $authHeadersAlice -UseBasicParsing
        $pagingOk = ($listBefore.Count -eq 2) -and ("$($listBefore[0].id)" -eq $postedIds[1]) -and ("$($listBefore[1].id)" -eq $postedIds[2])

        $sw.Stop()
        Record-Test "Message Pagination & Chronological Ordering (?before=&limit=50)" ($isOrdered -and $pagingOk) "Verified 5 messages returned chronologically; ?before query returned bounded sub-window" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Message Pagination & Chronological Ordering (?before=&limit=50)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # 5.17 Authorization Invariant - Non-Author Message Edit (403 Forbidden)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $aliceMsgBody = @{ content = "Alice Invariant Message ($uniqueId)" } | ConvertTo-Json -Compress
        $aliceMsgRes = Invoke-RestMethod -Uri "$BaseUrl/v1/channels/$chatChannelId/messages" -Method Post -Headers $authHeadersAlice -Body $aliceMsgBody -ContentType "application/json" -UseBasicParsing
        $aliceMsgId = "$($aliceMsgRes.id)"

        # Bob attempts to edit Alice's message -> 403 Forbidden
        $bobEditAttemptBody = @{ content = "Bob unauthorized edit attempt" } | ConvertTo-Json -Compress
        $null = Invoke-RestMethod -Uri "$BaseUrl/v1/channels/$chatChannelId/messages/$aliceMsgId" -Method Patch -Headers $authHeadersBob -Body $bobEditAttemptBody -ContentType "application/json" -UseBasicParsing
        $sw.Stop()
        Record-Test "Authorization Invariant - Non-Author Message Edit (403 Forbidden)" $false "Expected 403 Forbidden on non-author edit, but request succeeded" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        $statusCode = [int]$_.Exception.Response.StatusCode
        $isForbidden = ($statusCode -eq 403)
        Record-Test "Authorization Invariant - Non-Author Message Edit (403 Forbidden)" $isForbidden "Server rejected non-author edit with HTTP $statusCode" $sw.ElapsedMilliseconds
    }

    # 5.18 Authorization Invariant - Non-Author Message Delete (403 Forbidden)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        # Bob attempts to delete Alice's message -> 403 Forbidden
        $null = Invoke-RestMethod -Uri "$BaseUrl/v1/channels/$chatChannelId/messages/$aliceMsgId" -Method Delete -Headers $authHeadersBob -UseBasicParsing
        $sw.Stop()
        Record-Test "Authorization Invariant - Non-Author Message Delete (403 Forbidden)" $false "Expected 403 Forbidden on non-author delete, but request succeeded" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        $statusCode = [int]$_.Exception.Response.StatusCode
        $isForbidden = ($statusCode -eq 403)
        Record-Test "Authorization Invariant - Non-Author Message Delete (403 Forbidden)" $isForbidden "Server rejected non-author delete with HTTP $statusCode" $sw.ElapsedMilliseconds
    }

    # 5.19 Authorization Invariant - Guild Owner Message Delete (204 No Content)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        # Bob posts a message
        $bobMsgBody = @{ content = "Bob message for owner moderation ($uniqueId)" } | ConvertTo-Json -Compress
        $bobMsgRes = Invoke-RestMethod -Uri "$BaseUrl/v1/channels/$chatChannelId/messages" -Method Post -Headers $authHeadersBob -Body $bobMsgBody -ContentType "application/json" -UseBasicParsing
        $bobMsgId = "$($bobMsgRes.id)"

        # Guild Owner Alice deletes Bob's message -> 204 No Content
        $null = Invoke-RestMethod -Uri "$BaseUrl/v1/channels/$chatChannelId/messages/$bobMsgId" -Method Delete -Headers $authHeadersAlice -UseBasicParsing
        $sw.Stop()
        Record-Test "Authorization Invariant - Guild Owner Message Delete (204 No Content)" $true "Guild owner successfully deleted member message with 204 No Content" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Authorization Invariant - Guild Owner Message Delete (204 No Content)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

    # 5.20 Graceful WebSocket Disconnect (NormalClosure for both clients)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $ctsClose = [System.Threading.CancellationTokenSource]::new(3000)
        if ($wsAlice -and ($wsAlice.State -eq [System.Net.WebSockets.WebSocketState]::Open -or $wsAlice.State -eq [System.Net.WebSockets.WebSocketState]::CloseReceived)) {
            $wsAlice.CloseOutputAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "Client closing", $ctsClose.Token).Wait()
        }
        if ($wsBob -and ($wsBob.State -eq [System.Net.WebSockets.WebSocketState]::Open -or $wsBob.State -eq [System.Net.WebSockets.WebSocketState]::CloseReceived)) {
            $wsBob.CloseOutputAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "Client closing", $ctsClose.Token).Wait()
        }
        $ctsClose.Dispose()
        $sw.Stop()
        Record-Test "Graceful WebSocket Disconnect (NormalClosure for both clients)" $true "Both Alice and Bob WebSocket connections closed cleanly with NormalClosure" $sw.ElapsedMilliseconds
    } catch {
        $sw.Stop()
        Record-Test "Graceful WebSocket Disconnect (NormalClosure for both clients)" $false "Exception: $($_.Exception.Message)" $sw.ElapsedMilliseconds
    }

} finally {
    # Clean up WebSockets if still open
    if ($wsAlice) { try { $wsAlice.Dispose() } catch {} }
    if ($wsBob) { try { $wsBob.Dispose() } catch {} }

    # ==============================================================================
    # STEP 6: Gracefully Stop Background Server Process
    # ==============================================================================
    Log-Header "STEP 6: Graceful Shutdown of Background Server"
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
    } elseif ($serverProcess) {
        $sw.Stop()
        Record-Test "Graceful Server Teardown" $true "Server process already exited" $sw.ElapsedMilliseconds
    }
}

# ==============================================================================
# STEP 7: Frontend Client Build Verification
# ==============================================================================
Log-Header "STEP 7: Frontend Build Verification (cd concord-client && npm run build)"

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
# STEP 8: Pass / Fail Summary Table
# ==============================================================================
$GlobalStartTime.Stop()
Log-Header "STEP 8: Automated Verification Results Summary"

$passedCount = @($Results | Where-Object { $_.Success -eq $true }).Count
$failedCount = @($Results | Where-Object { $_.Success -eq $false }).Count
$totalCount = $Results.Count

Write-Host ""
$Results | Format-Table -Property Step, TestName, Status, Duration, Details -AutoSize

$summaryColor = if ($failedCount -eq 0) { "Green" } else { "Red" }
Write-Host ("-" * 80) -ForegroundColor Gray
Write-Host "TOTAL TESTS: $totalCount | PASSED: $passedCount | FAILED: $failedCount | DURATION: $($GlobalStartTime.Elapsed.ToString('mm\:ss\.fff'))" -ForegroundColor $summaryColor
Write-Host ("-" * 80) -ForegroundColor Gray
Write-Host ""

if ($failedCount -gt 0 -or @($Results | Where-Object { -not $_.Success }).Count -gt 0) {
    Write-Host "[FAIL] Verification suite encountered $failedCount failures." -ForegroundColor Red
    exit 1
} else {
    Write-Host "[PASS] All Milestone 2 verification stages executed successfully with ZERO failures!" -ForegroundColor Green
    exit 0
}
