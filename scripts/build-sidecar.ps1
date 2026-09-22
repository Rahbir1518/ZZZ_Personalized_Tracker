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
    --console `
    (Join-Path $backend 'zzz_sidecar\__main__.py')

if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed with exit code $LASTEXITCODE" }

$exe = Join-Path $outDir 'zzz-sidecar.exe'
if (-not (Test-Path $exe)) { throw "Expected $exe to exist after the build." }

Write-Host "==> Smoke-testing the binary" -ForegroundColor Cyan
# --help exits 0 without binding a port or touching the network.
& $exe --help | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'The built sidecar did not run.' }

Write-Host "==> Sidecar built: $exe" -ForegroundColor Green
