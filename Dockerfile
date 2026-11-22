FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build
FROM python:3.11-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-15 curl && rm -rf /var/lib/apt/lists/*
COPY --from=web /usr/local/bin/node /usr/local/bin/node
WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip setuptools && pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /web/.next/standalone /app/web
COPY --from=web /web/.next/static /app/web/.next/static
COPY --from=web /web/public /app/web/public
COPY deploy/start.sh /app/start.sh
RUN sed -i 's/\r$//' /app/start.sh && chmod +x /app/start.sh
EXPOSE 3000
CMD ["/bin/bash","/app/start.sh"]
