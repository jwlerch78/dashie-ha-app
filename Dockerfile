ARG BUILD_FROM
FROM ${BUILD_FROM}

# hassio-addons/base is Alpine-based. Add Node.js 20.
RUN apk add --no-cache nodejs npm

WORKDIR /app

# Install production deps first so this layer caches when only app code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the rest of the app. frontend/dashie-console is the git submodule — on the
# local `docker build` path it must be initialized before building.
COPY server/ ./server/
COPY frontend/ ./frontend/

# Entrypoint handled by bashio-enabled run.sh.
COPY run.sh /
RUN chmod a+x /run.sh

CMD ["/run.sh"]
