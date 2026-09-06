FROM node:20-slim

WORKDIR /app

# Copy package files and install all dependencies
COPY package*.json ./
RUN npm install

# Copy application files
COPY public/ ./public/
COPY server.js ./

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
