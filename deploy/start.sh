#!/bin/bash
set -e
mkdir -p /data/postgres /data/vault
chown -R postgres:postgres /data/postgres
if [ ! -s /data/postgres/PG_VERSION ]; then
 runuser -u postgres -- /usr/lib/postgresql/15/bin/initdb -D /data/postgres -A trust >/dev/null
fi
runuser -u postgres -- /usr/lib/postgresql/15/bin/pg_ctl -D /data/postgres -l /data/postgres/server.log -o "-h 127.0.0.1" start
runuser -u postgres -- psql -h 127.0.0.1 -tc "SELECT 1 FROM pg_database WHERE datname='vellum'" | grep -q 1 || runuser -u postgres -- createdb -h 127.0.0.1 vellum
if [ ! -f /data/secret ]; then python -c "import secrets;print(secrets.token_hex(48))" > /data/secret; chmod 600 /data/secret; fi
export SECRET_KEY=$(cat /data/secret)
export MAIL_FROM_NAME=Cryptrace
export DATABASE_URL=postgresql://postgres@127.0.0.1:5432/vellum
cd /app/backend
uvicorn app.main:app --host 127.0.0.1 --port 8000 &
API_PID=$!
for i in $(seq 1 60); do if curl -sf http://127.0.0.1:8000/openapi.json >/dev/null; then break; fi; sleep 1; done
python seed.py
cd /app/web
HOSTNAME=0.0.0.0 PORT=3000 node server.js &
WEB_PID=$!
trap 'kill $API_PID $WEB_PID; runuser -u postgres -- /usr/lib/postgresql/15/bin/pg_ctl -D /data/postgres stop' TERM INT
wait -n $API_PID $WEB_PID
