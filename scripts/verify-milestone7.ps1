# Concord Milestone 7 Verification Script
# Validates Quality of Life, Settings, and Desktop Polishes

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir

Write-Host "`n=== Concord Milestone 7 Verification ===" -ForegroundColor Cyan

# 1. Check required frontend source files
$requiredFiles = @(
    "concord-client/src/stores/settingsStore.ts",
    "concord-client/src/components/modals/UserSettingsModal.tsx",
    "concord-client/src/components/modals/UserProfileModal.tsx"
)

foreach ($f in $requiredFiles) {
    $fullPath = Join-Path $rootDir $f
    if (-not (Test-Path $fullPath)) {
        Write-Error "Missing required Milestone 7 file: $f"
    } else {
        Write-Host "  [+] Found $f" -ForegroundColor Green
    }
}

# 2. Check settingsStore capabilities
$settingsContent = Get-Content (Join-Path $rootDir "concord-client/src/stores/settingsStore.ts") -Raw
$requiredSettings = @(
    "inputDeviceId", "outputDeviceId", "inputVolume", "outputVolume",
    "inputMode", "pushToTalkKey", "sensitivity", "autoSensitivity",
    "noiseSuppression", "echoCancellation", "autoGainControl",
    "userVolumes", "localMutedUsers", "setUserVolume", "toggleLocalMute",
    "screenShareResolution", "screenShareFps", "screenShareVolume",
    "theme", "notificationsEnabled", "soundEnabled", "lastGuildId", "lastChannelId"
)

foreach ($setting in $requiredSettings) {
    if ($settingsContent -match $setting) {
        Write-Host "  [+] settingsStore includes $setting" -ForegroundColor Green
    } else {
        Write-Error "settingsStore is missing $setting"
    }
}

# 3. Check MessageItem capabilities (Reply, Reactions, Copy, Image Preview, Mentions)
$msgItemContent = Get-Content (Join-Path $rootDir "concord-client/src/components/chat/MessageItem.tsx") -Raw
$requiredMsgFeatures = @(
    "reply_to_id", "localReactions", "handleCopyText", "IMAGE_URL_REGEX", "renderFormattedContent"
)

foreach ($feat in $requiredMsgFeatures) {
    if ($msgItemContent -match $feat) {
        Write-Host "  [+] MessageItem includes $feat" -ForegroundColor Green
    } else {
        Write-Error "MessageItem is missing $feat"
    }
}

# 4. Check MemberList Context Menu features
$memberListContent = Get-Content (Join-Path $rootDir "concord-client/src/components/layout/MemberList.tsx") -Raw
$requiredMemberFeatures = @(
    "UserProfileModal", "userVolumes", "localMutedUsers", "setUserVolume", "toggleLocalMute", "Copiar ID do Usuário"
)

foreach ($feat in $requiredMemberFeatures) {
    if ($memberListContent -match $feat) {
        Write-Host "  [+] MemberList includes $feat" -ForegroundColor Green
    } else {
        Write-Error "MemberList is missing $feat"
    }
}

# 5. Check App.tsx global shortcuts and notifications
$appContent = Get-Content (Join-Path $rootDir "concord-client/src/App.tsx") -Raw
$requiredAppFeatures = @(
    "push_to_talk", "Notification", "toggleMute", "toggleDeafen", "lastGuildId", "lastChannelId"
)

foreach ($feat in $requiredAppFeatures) {
    if ($appContent -match $feat) {
        Write-Host "  [+] App.tsx includes $feat" -ForegroundColor Green
    } else {
        Write-Error "App.tsx is missing $feat"
    }
}

# 6. Execute TypeScript & Vite Production Build
Write-Host "`nRunning frontend build (tsc + vite build)..." -ForegroundColor Yellow
Push-Location (Join-Path $rootDir "concord-client")
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    cmd.exe /c "npm run build"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Frontend build failed with exit code $LASTEXITCODE"
    } else {
        Write-Host "  [+] Frontend production build succeeded with zero errors!" -ForegroundColor Green
    }
} finally {
    $ErrorActionPreference = $prevEAP
    Pop-Location
}

Write-Host "`n=== Milestone 7 Verification Completed Successfully! ===" -ForegroundColor Green
