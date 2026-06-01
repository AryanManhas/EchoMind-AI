# EchoMind Setup Guide

This guide prepares a fresh machine for the COM-811 EchoMind submission.

## Prerequisites

- Node.js `20.11.0`, as specified in `.nvmrc`
- npm `11.x`
- Git
- Docker Desktop with Compose
- Android Studio, Android SDK, and Java for native Android mobile builds
- Expo CLI through `npx expo`

## Fresh Clone Commands

```bash
git clone <repository-url>
cd "EchoMInd AI"
nvm use
npm install
npm run mobile:install
```

If `nvm` is unavailable, install Node.js 20.11.0 manually.

## Environment Files

```bash
cp .env.example .env
cp server/.env.example server/.env
```

Create `client/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_BACKEND_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080
```

Create `mobile/.env`:

```bash
EXPO_PUBLIC_API_URL=http://localhost:8080
EXPO_PUBLIC_WS_URL=ws://localhost:8080
EXPO_PUBLIC_ENABLE_PUSH_NOTIFICATIONS=false
EXPO_PUBLIC_GEMINI_API_KEY=replace_with_gemini_api_key_for_demo
```

## Docker Requirements

Start local infrastructure:

```bash
docker compose up -d db redis whisper
```

Services:

- PostgreSQL + pgvector: `localhost:5433`
- Redis: `localhost:6379`
- Whisper-compatible STT: `localhost:8000`

## Database Setup

Set in `server/.env`:

```bash
ENABLE_DATABASE=true
DATABASE_URL=postgresql://postgres:password@localhost:5433/echomind?schema=public
DIRECT_URL=postgresql://postgres:password@localhost:5433/echomind?schema=public
```

Run Prisma:

```bash
npm run db:generate
npm run db:migrate
```

The Prisma schema is in `server/prisma/schema.prisma`, and migrations are in `server/prisma/migrations/`.

## Redis Setup

Set in `server/.env`:

```bash
ENABLE_REDIS=true
ENABLE_QUEUES=true
REDIS_URL=redis://localhost:6379
```

Redis powers BullMQ queues for AI processing, embeddings, notifications, and dead-letter jobs.

## Running the Project

Terminal 1:

```bash
docker compose up -d
```

Terminal 2:

```bash
npm run dev:server
```

Terminal 3:

```bash
npm run dev:client
```

Terminal 4:

```bash
npm run dev:mobile
```

## Verification Commands

```bash
npm run type-check
npm run build
npm run lint
npm --prefix mobile run doctor
npm --prefix mobile run release-check
```

Database commands:

```bash
npm run db:generate
npm run db:studio
```
