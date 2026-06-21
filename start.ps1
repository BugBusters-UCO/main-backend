$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = if ($env:PORT) { $env:PORT } else { "5000" }

Set-Location $ProjectRoot
$Npm = "C:\Program Files\nodejs\npm.cmd"
if (-not (Test-Path $Npm)) {
    $Npm = "npm"
}

if (-not (Test-Path ".env") -and (Test-Path ".env.example")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example. Add GitHub OAuth credentials before using Connect GitHub."
}

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing Node dependencies..."
    & $Npm install
}

$ExistingListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($ExistingListener) {
    Write-Host "Port $Port is already in use by process $($ExistingListener.OwningProcess)."
    Write-Host "Stop it first with: Stop-Process -Id $($ExistingListener.OwningProcess) -Force"
    exit 1
}

Write-Host "Starting Main Backend on http://127.0.0.1:$Port"
Write-Host "Health: http://127.0.0.1:$Port/api/health"
$env:PORT = $Port
& $Npm start
