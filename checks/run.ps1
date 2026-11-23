$ErrorActionPreference = "Stop"
docker cp "$PSScriptRoot/integration.py" cryptrace:/tmp/integration.py
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker exec cryptrace python /tmp/integration.py
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker cp "$PSScriptRoot/observation.py" cryptrace:/tmp/observation_checks.py
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker exec cryptrace python /tmp/observation_checks.py
if ($LASTEXITCODE) { exit $LASTEXITCODE }
# Reset the live IP rate-limit window before the separate browser suite.
docker restart cryptrace
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker compose -f "$PSScriptRoot/../compose.yaml" up -d --wait
if ($LASTEXITCODE) { exit $LASTEXITCODE }
Push-Location "$PSScriptRoot/../web"
try { npx playwright test; if ($LASTEXITCODE) { exit $LASTEXITCODE } } finally { Pop-Location }
