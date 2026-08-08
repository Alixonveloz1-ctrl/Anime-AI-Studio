# ffmpeg + ffprobe from Debian, Node 22 on top.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
