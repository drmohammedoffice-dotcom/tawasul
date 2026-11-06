# Canonical Windows frontend dev entry: sync ASCII staging then start Vite on :5173.
$ErrorActionPreference = 'Stop'
$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $scriptsDir 'sync-frontend-ascii.ps1')
$dest = 'C:\xampp\htdocs\securechat-web'
Set-Location -LiteralPath $dest

$listen = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listen) {
  Write-Host "[dev-frontend] port 5173 already in use by PID $($listen.OwningProcess) — not starting a second Vite"
  exit 0
}

Write-Host '[dev-frontend] starting Vite on http://localhost:5173 (also allow http://127.0.0.1:5173 via CORS)'
& npx vite --host 127.0.0.1 --port 5173
