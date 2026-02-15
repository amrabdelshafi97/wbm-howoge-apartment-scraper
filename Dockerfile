FROM node:18-slim

WORKDIR /app

# Install Playwright dependencies and Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium-browser \
    chromium-codecs-ffmpeg \
    libnss3 \
    libxss1 \
    libappindicator1 \
    libindicator7 \
    libgconf-2-4 \
    fonts-dejavu-core \
    fonts-dejavu \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json* ./

# Install Node dependencies
RUN npm ci --only=production

# Copy application
COPY apartment-scraper.js .

# Ensure Node.js outputs logs to stdout/stderr immediately (no buffering)
ENV NODE_ENV=production

# Tell Playwright to use system Chromium instead of downloading
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true

# Run the service with unbuffered output
CMD ["node", "--no-warnings", "--unhandled-rejections=warn", "apartment-scraper.js"]
