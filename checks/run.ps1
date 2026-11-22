$ErrorActionPreference = "Stop"
docker cp "$PSScriptRoot/integration.py" vellum:/tmp/integration.py
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker exec vellum python /tmp/integration.py
if ($LASTEXITCODE) { exit $LASTEXITCODE }
Push-Location "$PSScriptRoot/../web"
try { npx playwright test; if ($LASTEXITCODE) { exit $LASTEXITCODE } } finally { Pop-Location }
