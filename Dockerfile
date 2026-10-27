# Official Debian Bookworm Node.js 22 LTS (Full glibc support for node-av & libmvec)
FROM node:22-bookworm-slim

# Install system dependencies: ffmpeg, yt-dlp, curl, python3
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    python3 \
    ca-certificates \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy project files
COPY package.json pnpm-lock.yaml* tsconfig.json ./
COPY src/ ./src/

# Install dependencies and build
RUN npm install

# Copy config if exists or use environment variables
COPY config*.json ./

ENV NODE_ENV=production

CMD ["npm", "start"]
