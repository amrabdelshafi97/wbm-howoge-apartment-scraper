FROM node:18-alpine

WORKDIR /app

# Install system dependencies for Playwright
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-dejavu \
    dumb-init

# Copy package files
COPY package.json package-lock.json* ./

# Install Node dependencies
RUN npm ci --only=production

# Set Playwright to use system Chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true

# Copy application
COPY apartment-scraper.js .

# Ensure Node.js outputs logs to stdout/stderr immediately (no buffering)
ENV NODE_ENV=production

# Use dumb-init to properly handle signals
ENTRYPOINT ["/usr/sbin/dumb-init", "--"]

# Run the service with unbuffered output
CMD ["node", "--no-warnings", "--unhandled-rejections=warn", "apartment-scraper.js"]
