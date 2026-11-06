# Windows-safe Vite production build for Unicode project paths.
# Avoids 8.3 short-path vs long-path mismatch that breaks vite:build-html / Rollup.
$ErrorActionPreference = 'Stop'
$scriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontend = (Resolve-Path (Join-Path $scriptsDir '..\frontend')).Path
Write-Host "[build-frontend] cwd=$frontend"
Set-Location -LiteralPath $frontend
& npx vite build
exit $LASTEXITCODE
