param(
    [switch]$SkipFrontend
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $repoRoot "venv\Scripts\python.exe"
$frontendPath = Join-Path $repoRoot "frontend"

if (-not (Test-Path -LiteralPath $pythonPath)) {
    throw "Backend verification requires a working root venv at venv\Scripts\python.exe. Recreate the local venv before running this script."
}

& $pythonPath --version *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Backend verification found venv\Scripts\python.exe, but the interpreter cannot start. Recreate the local venv before running this script."
}

Push-Location $repoRoot
try {
    & $pythonPath -m unittest discover -s backend/tests -p "test*.py" -v
    if ($LASTEXITCODE -ne 0) {
        throw "Backend tests failed with exit code $LASTEXITCODE."
    }

    if (-not $SkipFrontend) {
        Push-Location $frontendPath
        try {
            npm run lint
            if ($LASTEXITCODE -ne 0) {
                throw "Frontend lint failed with exit code $LASTEXITCODE."
            }
        }
        finally {
            Pop-Location
        }
    }
}
finally {
    Pop-Location
}
