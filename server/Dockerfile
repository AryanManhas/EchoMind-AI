# Stage 1: Build & Prisma Generate
FROM node:20-slim AS builder

# Install OpenSSL for Prisma and FFmpeg for Whisper audio streams
RUN apt-get update -y && apt-get install -y openssl ffmpeg

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma Client & compile TS
RUN npx prisma generate
# (Assuming a build script exists or just running with ts-node in production)
# For optimal prod we would compile, but for now we'll prep the files

# Stage 2: Production Runtime
FROM node:20-slim AS runner

RUN apt-get update -y && apt-get install -y openssl ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Only copy necessary files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "start"]
