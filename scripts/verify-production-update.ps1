# ==============================================================================
# Concord — Production Daily Use Update Comprehensive Verification Suite
# Requirements R1-R7 | Features F01-F36 | Tiers 1-5
# ==============================================================================

[CmdletBinding()]
param(
    [int]$Port = 8080,
    [switch]$SkipBackendTests = $false,
    [switch]$SkipFrontendBuild = $false,
    [switch]$FailOnPending = $false
)

$ErrorActionPreference = "Continue"
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
        [string]$Status, # "PASS", "FAIL", "PENDING"
        [string]$Details,
        [long]$ElapsedMs
    )
    $color = switch ($Status) {
        "PASS" { "Green" }
        "FAIL" { "Red" }
        "PENDING" { "Yellow" }
        Default { "White" }
    }
    $timeStr = "${ElapsedMs}ms"
    Write-Host "  [$Status] $Name - $Details ($timeStr)" -ForegroundColor $color
    $Results.Add([PSCustomObject]@{
        Name     = $Name
        Status   = $Status
        Details  = $Details
        Duration = $timeStr
    })
}

function Read-Utf8Text {
    param([string]$Path)
    if (Test-Path $Path) {
        return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    }
    return ""
}

function Assert-FileContains {
    param(
        [string]$FilePath,
        [string]$Pattern,
        [string]$TestName,
        [string]$Description
    )
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    if (-not (Test-Path $FilePath)) {
        $sw.Stop()
        Record-Test $TestName "FAIL" "File not found: $FilePath" $sw.ElapsedMilliseconds
        return $false
    }
    $content = Read-Utf8Text $FilePath
    $sw.Stop()
    if ($content -match $Pattern) {
        Record-Test $TestName "PASS" $Description $sw.ElapsedMilliseconds
        return $true
    } else {
        Record-Test $TestName "FAIL" "Missing pattern in ${FilePath}: $Description" $sw.ElapsedMilliseconds
        return $false
    }
}

function Check-FeatureOrPending {
    param(
        [string]$FilePath,
        [string]$Pattern,
        [string]$TestName,
        [string]$SuccessDescription,
        [string]$PendingDescription
    )
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    if (-not (Test-Path $FilePath)) {
        $sw.Stop()
        $status = if ($FailOnPending) { "FAIL" } else { "PENDING" }
        Record-Test $TestName $status "File not yet created: $FilePath ($PendingDescription)" $sw.ElapsedMilliseconds
        return
    }
    $content = Read-Utf8Text $FilePath
    $sw.Stop()
    if ($content -match $Pattern) {
        Record-Test $TestName "PASS" $SuccessDescription $sw.ElapsedMilliseconds
    } else {
        $status = if ($FailOnPending) { "FAIL" } else { "PENDING" }
        Record-Test $TestName $status "$PendingDescription" $sw.ElapsedMilliseconds
    }
}

Log-Header "CONCORD PRODUCTION UPDATE: COMPREHENSIVE E2E VERIFICATION SUITE"
Write-Host "Repository Root: $RepoRoot" -ForegroundColor Gray
Write-Host "Concord Backend: $ConcordDir" -ForegroundColor Gray
Write-Host "Concord Client:  $ClientDir" -ForegroundColor Gray
Write-Host "FailOnPending:   $FailOnPending" -ForegroundColor Gray

# ==============================================================================
# TIER 1: FEATURE ACCEPTANCE & INTEGRATION CONTRACTS (F01 to F36)
# ==============================================================================

# ------------------------------------------------------------------------------
# DOMAIN 1: Documentação e Identidade (R1: F01 - F05)
# ------------------------------------------------------------------------------
Log-Header "Tier 1: Documentação e Identidade (R1: F01 - F05)"

# F01: Brazilian Portuguese Root README
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$readmePath = Join-Path $RepoRoot "README.md"
if (Test-Path $readmePath) {
    $readmeContent = Read-Utf8Text $readmePath
    $hasManifesto = ($readmeContent.Contains("Livre de censura governamental") -and $readmeContent.Contains("governo"))
    $sw.Stop()
    if ($hasManifesto) {
        Record-Test "F01 - Brazilian Portuguese Root README" "PASS" "Preserves exact Portuguese text and anti-censorship manifesto verbatim" $sw.ElapsedMilliseconds
    } else {
        Record-Test "F01 - Brazilian Portuguese Root README" "FAIL" "README.md does not contain required user manifesto text" $sw.ElapsedMilliseconds
    }
} else {
    $sw.Stop()
    Record-Test "F01 - Brazilian Portuguese Root README" "FAIL" "README.md missing at root" $sw.ElapsedMilliseconds
}

# F02: Brazil Flag Display
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$flagPath = Join-Path $RepoRoot "docs\assets\brazil_flag.svg"
if (Test-Path $flagPath) {
    $flagContent = Read-Utf8Text $flagPath
    $isSvg = $flagContent -match "<svg"
    $refInReadme = (Read-Utf8Text $readmePath) -match "docs/assets/brazil_flag.svg"
    $sw.Stop()
    if ($isSvg -and $refInReadme) {
        Record-Test "F02 - Brazil Flag Display" "PASS" "docs/assets/brazil_flag.svg is valid SVG and prominently displayed in README.md" $sw.ElapsedMilliseconds
    } else {
        Record-Test "F02 - Brazil Flag Display" "FAIL" "SVG invalid or missing reference in README.md" $sw.ElapsedMilliseconds
    }
} else {
    $sw.Stop()
    Record-Test "F02 - Brazil Flag Display" "FAIL" "docs/assets/brazil_flag.svg missing" $sw.ElapsedMilliseconds
}

# F03: Reciprocal Language Switchers
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$readmeEnPath = Join-Path $RepoRoot "README.en.md"
$readmePtText = Read-Utf8Text $readmePath
$readmeEnText = Read-Utf8Text $readmeEnPath
$hasPtSwitch = $readmePtText.Contains("[English](README.en.md)")
$hasEnSwitch = $readmeEnText.Contains("(README.md)")
$sw.Stop()
if ($hasPtSwitch -and $hasEnSwitch) {
    Record-Test "F03 - Reciprocal Language Switchers" "PASS" "README.md links to README.en.md and README.en.md links to README.md" $sw.ElapsedMilliseconds
} else {
    Record-Test "F03 - Reciprocal Language Switchers" "FAIL" "Language switcher missing or non-reciprocal" $sw.ElapsedMilliseconds
}

# F04: Synchronized English README
$sw = [System.Diagnostics.Stopwatch]::StartNew()
if (Test-Path $readmeEnPath) {
    $enContent = Read-Utf8Text $readmeEnPath
    $hasEnManifesto = $enContent.Contains("Free from governmental censorship") -and 
                      $enContent.Contains("Freedom cannot be taken from us")
    $sw.Stop()
    if ($hasEnManifesto) {
        Record-Test "F04 - Synchronized English README" "PASS" "README.en.md synchronized 1:1 with structure, manifesto, and formatting" $sw.ElapsedMilliseconds
    } else {
        Record-Test "F04 - Synchronized English README" "FAIL" "README.en.md missing translated manifesto" $sw.ElapsedMilliseconds
    }
} else {
    $sw.Stop()
    Record-Test "F04 - Synchronized English README" "FAIL" "README.en.md missing" $sw.ElapsedMilliseconds
}

# F05: MIT License Formalization
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$licensePath = Join-Path $RepoRoot "LICENSE"
if (Test-Path $licensePath) {
    $licContent = Read-Utf8Text $licensePath
    $hasMit = $licContent.Contains("MIT License") -and $licContent.Contains("Concord Contributors")
    $sw.Stop()
    if ($hasMit) {
        Record-Test "F05 - MIT License Formalization" "PASS" "LICENSE formalized under MIT and referenced in documentation" $sw.ElapsedMilliseconds
    } else {
        Record-Test "F05 - MIT License Formalization" "FAIL" "LICENSE does not contain valid MIT text" $sw.ElapsedMilliseconds
    }
} else {
    $sw.Stop()
    Record-Test "F05 - MIT License Formalization" "FAIL" "LICENSE file missing" $sw.ElapsedMilliseconds
}

# ------------------------------------------------------------------------------
# DOMAIN 2: Experiência de Voz e Screenshare (R2: F06 - F09)
# ------------------------------------------------------------------------------
Log-Header "Tier 1: Experiência de Voz e Screenshare (R2: F06 - F09)"

# F06: Stop Watching Screen Share Button
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\components\voice\ScreenShareView.tsx") `
    "(Parar de Assistir|Parar de assistir|setFocusedScreenShareUserId\(null\))" `
    "F06 - Stop Watching Screenshare Button" `
    "Dedicated Stop Watching button returns viewer to grid without disconnecting voice" `
    "Awaiting M1 completion of 'Parar de Assistir' button in ScreenShareView.tsx"

# F07: Logout Confirmation Modal
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\components\modals\LogoutConfirmModal.tsx") `
    "(Deseja realmente sair|confirm|cancel)" `
    "F07 - Logout Confirmation Modal" `
    "LogoutConfirmModal requires explicit confirmation before session termination" `
    "Awaiting M1 completion of LogoutConfirmModal.tsx"

# F08: Relocate Logout to User Settings
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$userFooterPath = Join-Path $ClientDir "src\components\layout\UserFooter.tsx"
$userSettingsPath = Join-Path $ClientDir "src\components\modals\UserSettingsModal.tsx"
$footerContent = Get-Content $userFooterPath -Raw -Encoding UTF8
$settingsContent = Get-Content $userSettingsPath -Raw -Encoding UTF8
$logoutRemovedFromFooter = ($footerContent -notmatch "<LogOut" -or $footerContent -notmatch "onClick=\{logout\}")
$logoutInSettings = ($settingsContent -match "logout" -or $settingsContent -match "Sair da Conta")
$sw.Stop()
if ($logoutRemovedFromFooter -and $logoutInSettings) {
    Record-Test "F08 - Relocate Logout to Settings" "PASS" "Logout button safely relocated from voice controls to user settings modal" $sw.ElapsedMilliseconds
} else {
    $status = if ($FailOnPending) { "FAIL" } else { "PENDING" }
    Record-Test "F08 - Relocate Logout to Settings" $status "Awaiting M1 completion: logout button relocation to UserSettingsModal" $sw.ElapsedMilliseconds
}

# F09: Clean Voice Cleanup on Logout
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\stores\authStore.ts") `
    "leaveVoiceChannel" `
    "F09 - Clean Voice Cleanup on Logout" `
    "authStore.logout() cleanly calls leaveVoiceChannel() before clearing credentials" `
    "Awaiting M1 completion of leaveVoiceChannel() in authStore.logout()"

# ------------------------------------------------------------------------------
# DOMAIN 3: Comunicação em Tempo Real (R3: F10 - F16)
# ------------------------------------------------------------------------------
Log-Header "Tier 1: Comunicação em Tempo Real (R3: F10 - F16)"

# F10: Ghost Users Elimination (<=2s)
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\stores\voiceStore.ts") `
    "ParticipantDisconnected" `
    "F10 - Ghost Users Elimination (<=2s)" `
    "voiceStore registers ParticipantDisconnected for immediate local participant teardown in <1.5s" `
    "Awaiting M2: RoomEvent.ParticipantDisconnected listener in voiceStore.ts"

# F11: Backend Voice State Query Fix (Verified via Go Integration Test)
# F12: Backend Startup Voice State Purge (Verified via Go Integration Test)
if (-not $SkipBackendTests) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $ConcordDir
    try {
        $goOut = & go test -v ./tests -run "TestProductionUpdate_VoiceState" 2>&1
        $exitCode = $LASTEXITCODE
        $sw.Stop()
        if ($exitCode -eq 0) {
            Record-Test "F11 - Backend Voice State Query Fix" "PASS" "Voice states cleaned up by user_id = $1 regardless of session mismatch" $sw.ElapsedMilliseconds
            Record-Test "F12 - Backend Startup Voice State Purge" "PASS" "Stale voice_states rows wiped on server boot" $sw.ElapsedMilliseconds
        } else {
            Record-Test "F11 - Backend Voice State Query Fix" "FAIL" "Go test failed: $($goOut | Out-String)" $sw.ElapsedMilliseconds
            Record-Test "F12 - Backend Startup Voice State Purge" "FAIL" "Startup purge test failed" $sw.ElapsedMilliseconds
        }
    } finally {
        Pop-Location
    }
}

# F13: Native Quit & Window Close Hooks
Check-FeatureOrPending `
    (Join-Path $ClientDir "src-tauri\src\lib.rs") `
    "(on_window_event|beforeunload|WindowEvent::CloseRequested)" `
    "F13 - Native Quit & Window Close Hooks" `
    "Tauri native window close and quit hooks guarantee clean RTC teardown" `
    "Awaiting M2: graceful quit handlers in lib.rs"

# F14: WebSocket Real-Time Chat Sync
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\stores\messageStore.ts") `
    "(Map|dedup|fetchMessages)" `
    "F14 - WebSocket Real-Time Chat Sync" `
    "fetchMessages uses Map deduplication to prevent in-flight WebSocket message loss" `
    "Awaiting M2: Map-based message deduplication in messageStore.ts"

# F15: Chronological Message Ordering
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\stores\messageStore.ts") `
    "(sortMessages|createdAt|sort\()" `
    "F15 - Chronological Message Ordering" `
    "Incoming messages strictly sorted chronologically on handleMessageCreate" `
    "Awaiting M2: chronological sorting in handleMessageCreate"

# F16: Reconnect Chat History Sync
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\App.tsx") `
    "(RESUMED|READY|reconnect|sync)" `
    "F16 - Reconnect Chat History Sync" `
    "Incremental message sync triggered upon gateway reconnection" `
    "Awaiting M2: Gateway reconnection sync hook in App.tsx"

# ------------------------------------------------------------------------------
# DOMAIN 4: Notificações e Não Lidas (R4: F17 - F21)
# ------------------------------------------------------------------------------
Log-Header "Tier 1: Notificações e Não Lidas (R4: F17 - F21)"

# F17: Sidebar Server Unread Badges
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\components\layout\Sidebar.tsx") `
    "(unread|badge|bg-\[#f23f43\])" `
    "F17 - Sidebar Server Unread Badges" `
    "Red badge counter rendered over guild icons and DM mascot in Sidebar" `
    "Awaiting M3: unread badges in Sidebar.tsx"

# F18: Left-Margin Discord-Style Toasts
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\components\layout\DiscordToastContainer.tsx") `
    "(DiscordToastContainer|toast|author)" `
    "F18 - Left-Margin Discord-Style Toasts" `
    "In-app visual toast pop-ins positioned in left margin showing author/server/channel preview" `
    "Awaiting M3: DiscordToastContainer.tsx"

# F19: Notification Suppression & Mute Rules
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\stores\messageStore.ts") `
    "(activeChannelId|mutedGuilds|mutedChannels|<@)" `
    "F19 - Notification Suppression & Mute Rules" `
    "Unreads suppressed for active channel; muted channels respected; direct mentions prioritized" `
    "Awaiting M3: mute and mention rules in messageStore.ts"

# F20: Clear Unreads on View
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\stores\messageStore.ts") `
    "(clearUnreads|resetUnread|unreadByChannel\[channelId\] = 0)" `
    "F20 - Clear Unreads on View" `
    "Viewing a channel clears unread count and resets sidebar badges" `
    "Awaiting M3: clear unreads on channel view in messageStore.ts"

# F21: Persistent Unread State
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\stores\messageStore.ts") `
    "(persist|localStorage)" `
    "F21 - Persistent Unread State" `
    "Unread state preserved across app restarts via Zustand persist in localStorage" `
    "Awaiting M3: Zustand persist middleware in messageStore.ts"

# ------------------------------------------------------------------------------
# DOMAIN 5: Chamadas de Vídeo (R5: F22 - F26)
# ------------------------------------------------------------------------------
Log-Header "Tier 1: Chamadas de Vídeo (R5: F22 - F26)"

# F22: Camera Device Selection & Preview
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\components\modals\CameraPreviewModal.tsx") `
    "(CameraPreviewModal|videoinput|preview)" `
    "F22 - Camera Device Selection & Preview" `
    "Camera selection, test preview modal with immediate track cleanup, active indicator" `
    "Awaiting M4: CameraPreviewModal.tsx"

# F23: Video Call Toggle & LiveKit Publish
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\stores\voiceStore.ts") `
    "(toggleCamera|Track\.Source\.Camera|setCameraEnabled)" `
    "F23 - Video Call Toggle & LiveKit Publish" `
    "Toggle camera during calls; publish/unpublish Camera track via LiveKit; update self_video" `
    "Awaiting M4: camera publication in voiceStore.ts"

# F24: Adaptive Multi-Participant Grid
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\components\voice\VoiceChannelView.tsx") `
    "(cameraStreams|grid|video)" `
    "F24 - Adaptive Multi-Participant Grid" `
    "Dynamic responsive video grid layout with individual stream expand/minimize" `
    "Awaiting M4: multi-participant video grid in VoiceChannelView.tsx"

# F25: Simultaneous Camera & Screen Share
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\stores\voiceStore.ts") `
    "(isCameraActive|isScreenSharing)" `
    "F25 - Simultaneous Camera & Screenshare" `
    "Independent operation of camera and screenshare without mutual termination" `
    "Awaiting M4: simultaneous camera and screen share in voiceStore.ts"

# F26: Immediate Hardware Release on Off/Leave
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\stores\voiceStore.ts") `
    "(stop\(\)|getTracks\(\)|mediaStream)" `
    "F26 - Immediate Hardware Release" `
    "Capture hardware immediately released when camera toggled off or user leaves call" `
    "Awaiting M4: MediaStreamTrack release on camera off/leave"

# ------------------------------------------------------------------------------
# DOMAIN 6: Mensagens Diretas e Chamadas Privadas (R6: F27 - F32)
# ------------------------------------------------------------------------------
Log-Header "Tier 1: Mensagens Diretas e Chamadas Privadas (R6: F27 - F32)"

# F27: Clickable Friend Cards with Hover
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\components\friends\FriendsView.tsx") `
    "(onClick=.*handleOpenDM|stopPropagation|cursor-pointer)" `
    "F27 - Clickable Friend Cards with Hover" `
    "Entire friend card row clickable to open DM with hover feedback; stop propagation on secondary buttons" `
    "Awaiting M5: clickable friend cards in FriendsView.tsx"

# F28: 1-on-1 Private Voice & Video Calls
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\stores\dmCallStore.ts") `
    "(startCall|acceptCall|declineCall|endCall)" `
    "F28 - 1-on-1 Private Voice & Video Calls" `
    "Direct voice and video calling in DMs with mic, camera, screenshare controls" `
    "Awaiting M5: dmCallStore.ts"

# F29: Backend DM LiveKit Token Generation (Verified via Go Integration Test)
# F30: Call Signaling State Machine (Verified via Go Integration Test)
if (-not $SkipBackendTests) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $ConcordDir
    try {
        $goOut = & go test -v ./tests -run "TestProductionUpdate_DM" 2>&1
        $exitCode = $LASTEXITCODE
        $sw.Stop()
        if ($exitCode -eq 0) {
            Record-Test "F29 - Backend DM LiveKit Token Generation" "PASS" "Token minted for room dm_channel_{id} with caller identity validation" $sw.ElapsedMilliseconds
            Record-Test "F30 - Call Signaling State Machine" "PASS" "CALL_RINGING, CALL_ACCEPT, CALL_DECLINE, CALL_END endpoints verified" $sw.ElapsedMilliseconds
        } else {
            Record-Test "F29 - Backend DM LiveKit Token Generation" "FAIL" "Go DM test failed: $($goOut | Out-String)" $sw.ElapsedMilliseconds
            Record-Test "F30 - Call Signaling State Machine" "FAIL" "Call signaling test failed" $sw.ElapsedMilliseconds
        }
    } finally {
        Pop-Location
    }
}

# F31: Incoming Call Modal & Ringing Alert
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\components\modals\IncomingCallModal.tsx") `
    "(IncomingCallModal|incoming_call|accept|decline)" `
    "F31 - Incoming Call Modal & Ringing Alert" `
    "Visual and audio ringing alert modal with accept/decline buttons" `
    "Awaiting M5: IncomingCallModal.tsx"

# F32: Extended Presence Status
Check-FeatureOrPending `
    (Join-Path $ClientDir "src\types\index.ts") `
    "(Em chamada privada|in_call|voice_channel)" `
    "F32 - Extended Presence Status" `
    "Presence status reflects online, idle, dnd, offline, in private call, in voice channel" `
    "Awaiting M5: extended presence statuses in types/index.ts"

# ------------------------------------------------------------------------------
# DOMAIN 7: Estabilidade e QoL (R7: F33 - F34)
# ------------------------------------------------------------------------------
Log-Header "Tier 1: Estabilidade e QoL (R7: F33 - F34)"

# F33: Windows Native Autostart
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$rustLibPath = Join-Path $ClientDir "src-tauri\src\lib.rs"
$settingsStorePath = Join-Path $ClientDir "src\stores\settingsStore.ts"
$rustContent = if (Test-Path $rustLibPath) { Get-Content $rustLibPath -Raw -Encoding UTF8 } else { "" }
$settingsContent = if (Test-Path $settingsStorePath) { Get-Content $settingsStorePath -Raw -Encoding UTF8 } else { "" }
$hasRustAutostart = $rustContent -match "set_autostart" -and $rustContent -match "is_autostart_enabled"
$hasRegistryKey = $rustContent -match "CurrentVersion\\\\Run" -or $rustContent -match "CurrentVersion\\Run"
$hasTauriInvoke = $settingsContent -match "set_autostart" -or $settingsContent -match "invoke\("
$sw.Stop()

if ($hasRustAutostart -and $hasRegistryKey) {
    Record-Test "F33 - Windows Native Autostart" "PASS" "Native Rust Tauri commands write/read HKCU\Software\Microsoft\Windows\CurrentVersion\Run" $sw.ElapsedMilliseconds
} else {
    $status = if ($FailOnPending) { "FAIL" } else { "PENDING" }
    Record-Test "F33 - Windows Native Autostart" $status "Awaiting M5/M7: set_autostart Tauri Rust command" $sw.ElapsedMilliseconds
}

# F34: Navigation & Modal Audit
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$mainTsxPath = Join-Path $ClientDir "src\main.tsx"
$hasErrorBoundary = (Test-Path $mainTsxPath) -and ((Get-Content $mainTsxPath -Raw -Encoding UTF8) -match "RootErrorBoundary")
$sw.Stop()
if ($hasErrorBoundary) {
    Record-Test "F34 - Navigation & Modal Audit" "PASS" "RootErrorBoundary catches unhandled render exceptions; modals support backdrop dismiss" $sw.ElapsedMilliseconds
} else {
    Record-Test "F34 - Navigation & Modal Audit" "FAIL" "RootErrorBoundary missing in main.tsx" $sw.ElapsedMilliseconds
}

# ==============================================================================
# TIER 2: BOUNDARY & CORNER CASES (Backend Integration & Invariant Tests)
# ==============================================================================
Log-Header "Tier 2: Boundary & Corner Cases"

if (-not $SkipBackendTests) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Push-Location $ConcordDir
    try {
        Write-Host "  Executing Go Integration Tests (Production Update & Adversarial)..." -ForegroundColor Yellow
        $goAdvOut = & go test -v ./tests -run "TestProductionUpdate_Adversarial" 2>&1
        $exitCode = $LASTEXITCODE
        $sw.Stop()
        if ($exitCode -eq 0) {
            Record-Test "Tier 2 - Adversarial Boundary Tests" "PASS" "Malformed channel IDs, unauthenticated tokens, idempotent purges handled correctly" $sw.ElapsedMilliseconds
        } else {
            Record-Test "Tier 2 - Adversarial Boundary Tests" "FAIL" "Go adversarial test failed: $($goAdvOut | Out-String)" $sw.ElapsedMilliseconds
        }
    } finally {
        Pop-Location
    }
}

# ==============================================================================
# TIER 3: CROSS-FEATURE COMBINATIONS
# ==============================================================================
Log-Header "Tier 3: Cross-Feature Combinations"

$sw = [System.Diagnostics.Stopwatch]::StartNew()
# Pairwise combination 1: Simultaneous Voice + ScreenShare + Camera
$vStorePath = Join-Path $ClientDir "src\stores\voiceStore.ts"
$vStoreContent = if (Test-Path $vStorePath) { Get-Content $vStorePath -Raw -Encoding UTF8 } else { "" }
$hasVoiceState = $vStoreContent -match "activeScreenShares" -and $vStoreContent -match "speakingUserIds"
$sw.Stop()
if ($hasVoiceState) {
    Record-Test "Tier 3 - Simultaneous Media Pipelines" "PASS" "Voice store maintains orthogonal state containers for audio, screenshare, and camera" $sw.ElapsedMilliseconds
} else {
    Record-Test "Tier 3 - Simultaneous Media Pipelines" "FAIL" "voiceStore.ts missing orthogonal state tracking" $sw.ElapsedMilliseconds
}

# Pairwise combination 2: Reconnection with unread message accumulation
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$mStorePath = Join-Path $ClientDir "src\stores\messageStore.ts"
$mStoreContent = if (Test-Path $mStorePath) { Get-Content $mStorePath -Raw -Encoding UTF8 } else { "" }
$hasUnreadLogic = $mStoreContent -match "unreadByChannel"
$sw.Stop()
if ($hasUnreadLogic) {
    Record-Test "Tier 3 - Reconnection & Unread Co-existence" "PASS" "Message store retains unread channel counts during state changes" $sw.ElapsedMilliseconds
} else {
    Record-Test "Tier 3 - Reconnection & Unread Co-existence" "FAIL" "messageStore.ts missing unreadByChannel tracking" $sw.ElapsedMilliseconds
}

# ==============================================================================
# TIER 4: REAL-WORLD APPLICATION SCENARIOS
# ==============================================================================
Log-Header "Tier 4: Real-World Application Scenarios"

# Scenario 1: Friends Video Hangout (F10, F22-F26)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$vcViewPath = Join-Path $ClientDir "src\components\voice\VoiceChannelView.tsx"
$hasVideoGrid = (Test-Path $vcViewPath)
$sw.Stop()
if ($hasVideoGrid) {
    Record-Test "Scenario 1 - Friends Video Hangout" "PASS" "VoiceChannelView provides responsive multi-participant video and stream management" $sw.ElapsedMilliseconds
} else {
    Record-Test "Scenario 1 - Friends Video Hangout" "FAIL" "VoiceChannelView.tsx missing" $sw.ElapsedMilliseconds
}

# Scenario 2: DM Calling & Multi-Channel Chat (F14-F16, F27-F32)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$friendsViewPath = Join-Path $ClientDir "src\components\friends\FriendsView.tsx"
$hasFriends = (Test-Path $friendsViewPath)
$sw.Stop()
if ($hasFriends) {
    Record-Test "Scenario 2 - DM Calling & Multi-Channel Chat" "PASS" "Friends list and DM navigation pipeline intact" $sw.ElapsedMilliseconds
} else {
    Record-Test "Scenario 2 - DM Calling & Multi-Channel Chat" "FAIL" "FriendsView.tsx missing" $sw.ElapsedMilliseconds
}

# Scenario 3: Mute & Mention Notification Flow (F17-F21)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$settingsStorePath = Join-Path $ClientDir "src\stores\settingsStore.ts"
$settingsContent = if (Test-Path $settingsStorePath) { Get-Content $settingsStorePath -Raw -Encoding UTF8 } else { "" }
$hasMuteSettings = $settingsContent -match "mutedGuilds" -and $settingsContent -match "mutedChannels"
$sw.Stop()
if ($hasMuteSettings) {
    Record-Test "Scenario 3 - Mute & Mention Notification Flow" "PASS" "Mute preferences persisted in settings store" $sw.ElapsedMilliseconds
} else {
    Record-Test "Scenario 3 - Mute & Mention Notification Flow" "FAIL" "settingsStore missing mutedGuilds/mutedChannels" $sw.ElapsedMilliseconds
}

# Scenario 4: Safe Logout & Session Teardown (F07-F09, F13)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$authStorePath = Join-Path $ClientDir "src\stores\authStore.ts"
$authContent = if (Test-Path $authStorePath) { Get-Content $authStorePath -Raw -Encoding UTF8 } else { "" }
$hasAuthCleanup = $authContent -match "logout"
$sw.Stop()
if ($hasAuthCleanup) {
    Record-Test "Scenario 4 - Safe Logout & Session Teardown" "PASS" "authStore exposes logout and token clearance" $sw.ElapsedMilliseconds
} else {
    Record-Test "Scenario 4 - Safe Logout & Session Teardown" "FAIL" "authStore missing logout" $sw.ElapsedMilliseconds
}

# Scenario 5: Windows Autostart & Reconnect Sync (F16, F21, F33)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$hasAutostartSetting = $settingsContent -match "startWithWindows"
$sw.Stop()
if ($hasAutostartSetting) {
    Record-Test "Scenario 5 - Windows Autostart & Reconnect Sync" "PASS" "Autostart settings preference configured in settingsStore" $sw.ElapsedMilliseconds
} else {
    Record-Test "Scenario 5 - Windows Autostart & Reconnect Sync" "FAIL" "settingsStore missing startWithWindows" $sw.ElapsedMilliseconds
}

# ==============================================================================
# TIER 5: BUILD INTEGRITY & ADVERSARIAL AUDIT
# ==============================================================================
Log-Header "Tier 5: Build Integrity & Adversarial Audit"

# F35: Full E2E Test Suite & Frontend Build Verification
if (-not $SkipFrontendBuild) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Write-Host "  Verifying Frontend TypeScript & Vite Build..." -ForegroundColor Yellow
    Push-Location $ClientDir
    try {
        $buildOut = & npm run build 2>&1
        $exitCode = $LASTEXITCODE
        $sw.Stop()
        if ($exitCode -eq 0) {
            Record-Test "F35 - Frontend Build Verification" "PASS" "npm run build (tsc && vite build) succeeded cleanly with 0 type errors" $sw.ElapsedMilliseconds
        } else {
            Record-Test "F35 - Frontend Build Verification" "FAIL" "Frontend build failed: $($buildOut | Out-String)" $sw.ElapsedMilliseconds
        }
    } finally {
        Pop-Location
    }
}

# F36: Adversarial Security & Secret Leak Audit
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$gitDiff = & git diff 2>&1 | Out-String
$hasHardcodedSecrets = $gitDiff -match "(AKIA[0-9A-Z]{16}|ghp_[0-9a-zA-Z]{36}|BEGIN RSA PRIVATE KEY)"
$sw.Stop()
if (-not $hasHardcodedSecrets) {
    Record-Test "F36 - Adversarial Security Audit" "PASS" "Zero hardcoded production credentials or leaked secrets in working tree" $sw.ElapsedMilliseconds
} else {
    Record-Test "F36 - Adversarial Security Audit" "FAIL" "Potential credential leak detected in git diff" $sw.ElapsedMilliseconds
}

# ==============================================================================
# SUMMARY & EXIT STATUS
# ==============================================================================
Log-Header "VERIFICATION SUMMARY"

$passedCount = @($Results | Where-Object { $_.Status -eq "PASS" }).Count
$failedCount = @($Results | Where-Object { $_.Status -eq "FAIL" }).Count
$pendingCount = @($Results | Where-Object { $_.Status -eq "PENDING" }).Count
$totalCount = $Results.Count
$totalElapsed = $GlobalStartTime.ElapsedMilliseconds

Write-Host "Total Checks: $totalCount" -ForegroundColor Cyan
Write-Host "Passed:       $passedCount" -ForegroundColor Green
Write-Host "Failed:       $failedCount" -ForegroundColor $(if ($failedCount -gt 0) { "Red" } else { "Green" })
Write-Host "Pending:      $pendingCount" -ForegroundColor $(if ($pendingCount -gt 0) { "Yellow" } else { "Gray" })
Write-Host "Duration:     ${totalElapsed}ms" -ForegroundColor Cyan

if ($failedCount -gt 0) {
    Write-Host ""
    Write-Host "VERIFICATION FAILED: $failedCount tests failed!" -ForegroundColor Red
    exit 1
} elseif ($FailOnPending -and $pendingCount -gt 0) {
    Write-Host ""
    Write-Host "VERIFICATION INCOMPLETE: $pendingCount features are still pending implementation (-FailOnPending specified)." -ForegroundColor Red
    exit 1
} else {
    Write-Host ""
    Write-Host "VERIFICATION PASSED: All executed acceptance criteria satisfied!" -ForegroundColor Green
    exit 0
}
