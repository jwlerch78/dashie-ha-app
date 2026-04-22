FROM node:20-alpine

# jq for parsing /data/options.json (HAOS mounts user config here).
RUN apk add --no-cache jq

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
