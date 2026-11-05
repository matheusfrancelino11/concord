param(
    [string]$Version,
    [string]$Notes = "Atualizacao e melhorias no Concord.",
    [switch]$SkipBuild,
    [string]$ServerHost,
    [string]$SshKeyPath,
    [string]$UpdateBaseUrl
)

$ErrorActionPreference = "Stop"

$workspaceRoot = (Get-Item $PSScriptRoot).Parent.FullName
Set-Location $workspaceRoot

# Carregar configuracoes locais se existirem (ignorado no git)
$localConfigFile = Join-Path $PSScriptRoot ".publish-config.ps1"
if (Test-Path $localConfigFile) {
    . $localConfigFile
}

# Tambem ler VITE_API_URL do concord-client/.env.production (ignorado no git)
$envProdFile = Join-Path $workspaceRoot "concord-client/.env.production"
if ((-not $UpdateBaseUrl) -and (Test-Path $envProdFile)) {
    $apiLine = Get-Content $envProdFile | Where-Object { $_ -match '^VITE_API_URL=' } | Select-Object -First 1
    if ($apiLine) {
        $baseOrigin = ($apiLine -replace '^VITE_API_URL=', '').Trim() -replace '/v1/?$', ''
        $UpdateBaseUrl = "$baseOrigin/updates"
    }
}

if (-not $ServerHost) {
    $ServerHost = if ($env:CONCORD_SERVER_HOST) { $env:CONCORD_SERVER_HOST } else { "concord.exemplo.com" }
}
if (-not $SshKeyPath) {
    $SshKeyPath = if ($env:CONCORD_SSH_KEY) { $env:CONCORD_SSH_KEY } else { "" }
}
if (-not $UpdateBaseUrl) {
    $UpdateBaseUrl = if ($env:CONCORD_UPDATES_URL) { $env:CONCORD_UPDATES_URL } else { "https://$ServerHost/updates" }
}

# 1. Carregar configuracao atual
$tauriConfPath = Join-Path $workspaceRoot "concord-client/src-tauri/tauri.conf.json"
$tauriConf = Get-Content $tauriConfPath -Raw | ConvertFrom-Json

if (-not $Version) {
    Write-Host "Versao atual do Concord: $($tauriConf.version)" -ForegroundColor Cyan
    $Version = Read-Host "Digite a nova versao (ex: 0.1.1)"
    if (-not $Version) {
        $Version = $tauriConf.version
    }
}

Write-Host "Lancando Concord v$Version..." -ForegroundColor Green

# 2. Atualizar versao nos manifestos
$tauriConf.version = $Version
$tauriConf | ConvertTo-Json -Depth 10 | Set-Content $tauriConfPath

$pkgJsonPath = Join-Path $workspaceRoot "concord-client/package.json"
$pkgJson = Get-Content $pkgJsonPath -Raw | ConvertFrom-Json
$pkgJson.version = $Version
$pkgJson | ConvertTo-Json -Depth 10 | Set-Content $pkgJsonPath

# 3. Carregar chave privada para assinatura digital do Tauri
$keyFile = Join-Path $workspaceRoot "concord-client/src-tauri/concord-updater.key"
if (-not (Test-Path $keyFile)) {
    Write-Error "Chave privada nao encontrada em $keyFile"
    exit 1
}
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $keyFile -Raw

# 4. Compilar versao assinada (injetando endpoint real apenas durante o build e restaurando o placeholder depois)
if (-not $SkipBuild) {
    Write-Host "Compilando aplicativo e gerando patches assinados..." -ForegroundColor Cyan
    $placeholderEndpoint = "https://concord.exemplo.com/updates/latest.json"
    try {
        $tauriConf.plugins.updater.endpoints = @("$UpdateBaseUrl/latest.json")
        $tauriConf | ConvertTo-Json -Depth 10 | Set-Content $tauriConfPath
        Set-Location (Join-Path $workspaceRoot "concord-client")
        npm run tauri build
    } finally {
        Set-Location $workspaceRoot
        $tauriConf.plugins.updater.endpoints = @($placeholderEndpoint)
        $tauriConf | ConvertTo-Json -Depth 10 | Set-Content $tauriConfPath
    }
} else {
    Write-Host "Pulando compilacao (usando artefatos existentes)..." -ForegroundColor Yellow
}

# 5. Localizar artefatos gerados
$bundleDir = Join-Path $workspaceRoot "concord-client/src-tauri/target/release/bundle"
$nsisExe = Get-ChildItem -Path (Join-Path $bundleDir "nsis") -Filter "*$Version*setup.exe" | Select-Object -First 1
if (-not $nsisExe) {
    $nsisExe = Get-ChildItem -Path (Join-Path $bundleDir "nsis") -Filter "*setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

$nsisSig = $null
if ($nsisExe) {
    $candidateSig = Join-Path (Join-Path $bundleDir "nsis") "$($nsisExe.Name).sig"
    if (Test-Path $candidateSig) {
        $nsisSig = Get-Item $candidateSig
    }
}

$msiFile = Get-ChildItem -Path (Join-Path $bundleDir "msi") -Filter "*$Version*.msi" | Select-Object -First 1
if (-not $msiFile) {
    $msiFile = Get-ChildItem -Path (Join-Path $bundleDir "msi") -Filter "*.msi" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

$msiSig = $null
if ($msiFile) {
    $candidateMsiSig = Join-Path (Join-Path $bundleDir "msi") "$($msiFile.Name).sig"
    if (Test-Path $candidateMsiSig) {
        $msiSig = Get-Item $candidateMsiSig
    }
}

$updateTarget = $null
$signatureContent = ""

if ($nsisSig) {
    $updateTarget = $nsisExe
    $signatureContent = (Get-Content $nsisSig.FullName -Raw).Trim()
} elseif ($msiSig) {
    $updateTarget = $msiFile
    $signatureContent = (Get-Content $msiSig.FullName -Raw).Trim()
}

if (-not $updateTarget) {
    $updateTarget = $nsisExe
}

$updateFileName = $updateTarget.Name
$pubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

# 6. Criar manifest latest.json para o Tauri Auto-Updater
$latestManifest = @{
    version = $Version
    notes = $Notes
    pub_date = $pubDate
    platforms = @{
        "windows-x86_64" = @{
            signature = $signatureContent
            url = "$UpdateBaseUrl/$updateFileName"
        }
    }
}

$latestJsonPath = Join-Path $workspaceRoot "release/latest.json"
$latestManifest | ConvertTo-Json -Depth 5 | Set-Content $latestJsonPath

Write-Host "Manifest latest.json gerado:" -ForegroundColor Cyan
Get-Content $latestJsonPath

# 7. Atualizar pasta local de release
Copy-Item $nsisExe.FullName (Join-Path $workspaceRoot "release/Concord_Setup.exe") -Force
Copy-Item $msiFile.FullName (Join-Path $workspaceRoot "release/Concord_Setup.msi") -Force
$portableExe = Join-Path $workspaceRoot "concord-client/src-tauri/target/release/concord-client.exe"
if (Test-Path $portableExe) {
    Copy-Item $portableExe (Join-Path $workspaceRoot "release/Concord_Portable.exe") -Force
}

# 8. Atualizar Concord-Windows.zip
$zipPath = Join-Path $workspaceRoot "Concord-Windows.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path "$workspaceRoot/release/*" -DestinationPath $zipPath -Force

# 9. Enviar atualizacao para o servidor remoto
if ($SshKeyPath -and (Test-Path $SshKeyPath)) {
    Write-Host "Enviando atualizacao para o servidor ($ServerHost)..." -ForegroundColor Cyan
    scp -i $SshKeyPath -o StrictHostKeyChecking=no $updateTarget.FullName "ubuntu@$ServerHost`:~/updates/$updateFileName"
    scp -i $SshKeyPath -o StrictHostKeyChecking=no $latestJsonPath "ubuntu@$ServerHost`:~/updates/latest.json"

    Write-Host "Sucesso! Concord v$Version publicado com sucesso no servidor!" -ForegroundColor Green
    Write-Host "Link publico do manifest: $UpdateBaseUrl/latest.json"
    Write-Host "Link do instalador: $UpdateBaseUrl/$updateFileName"
} else {
    Write-Host "Caminho da chave SSH nao configurado. Pulando upload via SCP." -ForegroundColor Yellow
    Write-Host "Artefatos compilados e manifest gerados localmente em release/." -ForegroundColor Green
}
