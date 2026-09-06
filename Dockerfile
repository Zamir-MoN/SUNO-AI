FROM node:20-slim

WORKDIR /app

# Copy package files and install all dependencies
COPY package*.json ./
RUN npm install

# Copy application files
COPY public/ ./public/
COPY server.js ./

CMD ["node", "server.js"]
