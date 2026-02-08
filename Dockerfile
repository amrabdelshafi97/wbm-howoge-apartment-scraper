FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --only=production

# Copy application
COPY apartment-scraper.js .

# Run the service
CMD ["node", "apartment-scraper.js"]
