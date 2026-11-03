# scripts/start-postgres.ps1
# Script para iniciar o serviço local de PostgreSQL do Concord se não estiver rodando

$pgBin = "C:\Program Files\PostgreSQL\18\bin"
$pgData = "C:\Program Files\PostgreSQL\18\data"
$port = 5432

Write-Host "==> Verificando conexão com PostgreSQL na porta $port..." -ForegroundColor Cyan

$tcp = Test-NetConnection -ComputerName 127.0.0.1 -Port $port -WarningAction SilentlyContinue

if ($tcp.TcpTestSucceeded) {
    Write-Host "==> PostgreSQL já está ativo e aceitando conexões na porta $port!" -ForegroundColor Green
    exit 0
}

Write-Host "==> PostgreSQL não está rodando. Verificando bloqueios residuais..." -ForegroundColor Yellow

$pidFile = Join-Path $pgData "postmaster.pid"
if (Test-Path $pidFile) {
    $stalePid = (Get-Content $pidFile)[0].Trim()
    $proc = Get-Process -Id $stalePid -ErrorAction SilentlyContinue
    if (-not $proc) {
        Write-Host "==> Removendo arquivo de PID órfão ($stalePid)..." -ForegroundColor Yellow
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "==> Iniciando o motor do PostgreSQL..." -ForegroundColor Cyan
& "$pgBin\pg_ctl.exe" start -D "$pgData"

# Aguarda até 10 segundos pela inicialização
$attempts = 0
while ($attempts -lt 10) {
    Start-Sleep -Seconds 1
    $tcp = Test-NetConnection -ComputerName 127.0.0.1 -Port $port -WarningAction SilentlyContinue
    if ($tcp.TcpTestSucceeded) {
        Write-Host "==> PostgreSQL iniciado com sucesso e pronto para uso!" -ForegroundColor Green
        exit 0
    }
    $attempts++
}

Write-Host "==> Dica: Se o serviço do Windows estiver parado, abra o PowerShell como Administrador e execute:" -ForegroundColor Yellow
Write-Host "    Set-Service -Name postgresql-x64-18 -StartupType Automatic; Start-Service postgresql-x64-18" -ForegroundColor White
