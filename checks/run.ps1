$ErrorActionPreference = "Stop"
docker cp "$PSScriptRoot/integration.py" vellum:/tmp/integration.py
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker exec vellum python /tmp/integration.py
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker cp "$PSScriptRoot/observation.py" vellum:/tmp/observation_checks.py
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker exec vellum python /tmp/observation_checks.py
if ($LASTEXITCODE) { exit $LASTEXITCODE }
# Reset the live IP rate-limit window before the separate browser suite.
docker restart vellum
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker compose -f "$PSScriptRoot/../compose.yaml" up -d --wait
if ($LASTEXITCODE) { exit $LASTEXITCODE }
Push-Location "$PSScriptRoot/../web"
try { npx playwright test; if ($LASTEXITCODE) { exit $LASTEXITCODE } } finally { Pop-Location }
