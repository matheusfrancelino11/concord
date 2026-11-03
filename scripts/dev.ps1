# scripts/dev.ps1
# Inicia PostgreSQL (se necessário), servidor Go e cliente desktop Tauri

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "==========================================" -ForegroundColor Green
Write-Host "       Concord - Ambiente de Dev          " -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

# 1. Start Postgres
& "$PSScriptRoot\start-postgres.ps1"

# 2. Check if Go server is already listening
$backendTest = Test-NetConnection -ComputerName 127.0.0.1 -Port 8080 -WarningAction SilentlyContinue
if (-not $backendTest.TcpTestSucceeded) {
    Write-Host "==> Iniciando Backend Go (porta 8080) em nova janela..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\concord'; go run ./cmd/server"
    Start-Sleep -Seconds 2
} else {
    Write-Host "==> Backend Go já está respondendo na porta 8080." -ForegroundColor Green
}

# 3. Start Tauri Desktop App
Write-Host "==> Iniciando Concord Desktop App (Tauri dev)..." -ForegroundColor Cyan
Set-Location "$root\concord-client"
npm run tauri dev
