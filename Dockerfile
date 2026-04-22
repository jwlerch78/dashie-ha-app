ARG BUILD_FROM
FROM ${BUILD_FROM}

# Base image is node:20-alpine — no s6-overlay, no bashio. We read HAOS config
# options from /data/options.json (auto-mounted by Supervisor).
RUN apk add --no-cache --update jq

WORKDIR /app

# Install production deps first so this layer caches when only app code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the rest of the app.
COPY server/ ./server/
COPY frontend/ ./frontend/

COPY run.sh /
RUN chmod a+x /run.sh

CMD ["/run.sh"]
