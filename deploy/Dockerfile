# Travelr - Docker deployment
# Debian-based Node.js with security hardening

FROM node:24-bookworm-slim

# Install git and other useful tools, then clean up
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    dumb-init \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user for security
RUN groupadd --gid 1001 travelr \
    && useradd --uid 1001 --gid travelr --shell /bin/bash --create-home travelr

WORKDIR /app

# Copy root package.json and workspace package.json files
COPY package.json package-lock.json* ./
COPY client/package.json ./client/
COPY server/package.json ./server/

# Install all dependencies (workspaces handled by npm)
RUN npm install --production=false

# Copy source files
COPY tsconfig.base.json ./
COPY version.txt ./
COPY client/ ./client/
COPY server/ ./server/
COPY dataConfig/ ./dataConfig/

# Build client and server
RUN npm run build

# Create directories for runtime data and set ownership of ALL of /app.
# The chown -R makes everything (including client/, server/, scripts/) writable
# by travelr. This is required for deploy-quick, which extracts .ts files and
# rebuilds in-place while running as USER travelr.
RUN mkdir -p /app/dataTrips /app/dataDiagnostics /app/dataUserPrefs /app/dataUsers /app/dataCountries \
    && chown -R travelr:travelr /app

# Copy data files AFTER the chown. COPY creates root-owned files, so we use
# --chown to make them writable by travelr at runtime.
COPY --chown=travelr:travelr dataUsers/ ./dataUsers/
COPY --chown=travelr:travelr dataTrips/ ./dataTrips/
COPY --chown=travelr:travelr dataUserPrefs/ ./dataUserPrefs/
COPY --chown=travelr:travelr dataCountries/ ./dataCountries/

# NOTE: We keep dev dependencies (tsc, vite) for deploy-quick support.
# Deploy-quick extracts new source files and runs `npm run build` in-container.
# This makes the image larger (~200MB more) but enables fast deploys without
# rebuilding the entire Docker image.

# Expose the server port
EXPOSE 4000

# Environment variables (override at runtime)
ENV PORT=4000
ENV NODE_ENV=production
ENV TRAVELR_CONFIG=prod-debian

# Health check - verify the API server is responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:4000/ping || exit 1

# Required secrets - set these at runtime via docker run -e or docker-compose:
# OPENAI_API_KEY, GOOGLE_API_KEY, GOOGLE_CX

# Switch to non-root user
USER travelr

# Use dumb-init to handle signals properly (PID 1 problem)
ENTRYPOINT ["dumb-init", "--"]

# Start via server-runner (uses tsx to run TypeScript directly)
CMD ["npx", "tsx", "server/src/server-runner.ts"]
