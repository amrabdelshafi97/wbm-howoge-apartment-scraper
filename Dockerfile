FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --only=production

# Copy application
COPY apartment-scraper.js .

# Create volume mount point for data
VOLUME ["/app/apartments-data.json"]

# Run the service
CMD ["node", "apartment-scraper.js"]
