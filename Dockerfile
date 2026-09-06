FROM node:20-slim

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY public/ ./public/
COPY server.js ./

# Expose default port
ENV PORT=3000
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
