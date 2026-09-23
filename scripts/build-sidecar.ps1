# Builds the Python sidecar into a single executable that Electron ships and
# spawns, so end users never need Python installed.
#
#   npm run sidecar:build
#
# Output lands in resources/sidecar/, which electron-builder copies into the
# installer via the extraResources rule in electron-builder.yml.

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$venvPython = Join-Path $backend '.venv\Scripts\python.exe'
$outDir = Join-Path $root 'resources\sidecar'

if (-not (Test-Path $venvPython)) {
    throw "No virtualenv at $venvPython. Run 'npm run sidecar:install' first."
}

Write-Host '==> Building sidecar with PyInstaller' -ForegroundColor Cyan

# --collect-all is needed for these three: genshin and hakushin ship Pydantic
# models that PyInstaller's static analysis does not fully discover, and
# uvicorn loads its protocol implementations by string name at runtime.
#
# --add-data ships schema.sql and domain_pairs.json: both are read via
# Path(__file__).parent at runtime (not a Python import), so PyInstaller's
# static analysis never sees them as a dependency and silently leaves them
# out unless told to. Missing one doesn't fail this build or the --help smoke
# test below - it only fails the moment the packaged app actually tries to
# open the cache / compute Farm Together, which is exactly how the missing
# schema.sql went unnoticed once already.
$schemaSql = Join-Path $backend 'zzz_sidecar\cache\schema.sql'
$domainPairs = Join-Path $backend 'zzz_sidecar\services\domain_pairs.json'
& $venvPython -m PyInstaller `
    --noconfirm `
    --clean `
    --onefile `
    --name zzz-sidecar `
    --distpath $outDir `
    --workpath (Join-Path $backend 'build') `
    --specpath $backend `
    --collect-all genshin `
    --collect-all hakushin `
    --collect-all uvicorn `
    --hidden-import zzz_sidecar.app `
    --add-data "${schemaSql};zzz_sidecar/cache" `
    --add-data "${domainPairs};zzz_sidecar/services" `
    --console `
    (Join-Path $backend 'run_sidecar.py')

if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed with exit code $LASTEXITCODE" }

$exe = Join-Path $outDir 'zzz-sidecar.exe'
if (-not (Test-Path $exe)) { throw "Expected $exe to exist after the build." }

Write-Host "==> Smoke-testing the binary" -ForegroundColor Cyan
# --help alone isn't enough: argparse exits before uvicorn ever imports
# zzz_sidecar.app, so it can't catch a broken import chain or a missing
# bundled data file (this is exactly how the missing schema.sql above went
# unnoticed once already). Actually start the server the way Electron does
# and confirm /health responds.
& $exe --help | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'The built sidecar did not run for --help.' }

$smokeToken = [guid]::NewGuid().ToString('N')
$smokeDataDir = Join-Path ([System.IO.Path]::GetTempPath()) "zzz-sidecar-smoke-$smokeToken"
$proc = Start-Process -FilePath $exe `
    -ArgumentList @('--port', '18779', '--token', $smokeToken, '--data-dir', $smokeDataDir) `
    -PassThru -WindowStyle Hidden -RedirectStandardError (Join-Path $env:TEMP "$smokeToken.err.log")

try {
    $healthy = $false
    for ($i = 0; $i -lt 60; $i++) {
        if ($proc.HasExited) { break }
        try {
            $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:18779/health' `
                -Headers @{ 'X-Sidecar-Token' = $smokeToken } -UseBasicParsing -TimeoutSec 1
            if ($resp.StatusCode -eq 200) { $healthy = $true; break }
        } catch {}
        Start-Sleep -Milliseconds 500
    }

    if (-not $healthy) {
        $log = Join-Path $env:TEMP "$smokeToken.err.log"
        $tail = if (Test-Path $log) { Get-Content $log -Raw } else { '(no stderr captured)' }
        throw "The built sidecar did not answer /health. stderr:`n$tail"
    }
} finally {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
    Remove-Item -Recurse -Force $smokeDataDir -ErrorAction SilentlyContinue
    Remove-Item -Force (Join-Path $env:TEMP "$smokeToken.err.log") -ErrorAction SilentlyContinue
}

Write-Host "==> Sidecar built: $exe" -ForegroundColor Green
