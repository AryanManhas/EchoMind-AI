# EchoMind Deployment Guide

## Backend Deployment

The backend can be deployed with the root `Dockerfile` or as the `server/` Node app.

### Docker

```bash
docker build -t echomind-api .
docker run --env-file server/.env -p 8080:8080 echomind-api
```

### Render or Railway

1. Create a PostgreSQL database with pgvector support, such as Neon or a managed Postgres instance with the `vector` extension.
2. Create a Redis instance.
3. Deploy the API using `render.yaml`, Railway configuration, or the root Dockerfile.
4. Set production environment variables.
5. Run Prisma migrations during build or release:

```bash
npx prisma migrate deploy
npm run build
npm run start
```

## Web Deployment

Deploy `client/` to Vercel or any Next.js 15-compatible host.

Required web variables:

```bash
NEXT_PUBLIC_API_URL=https://<api-host>
NEXT_PUBLIC_BACKEND_URL=https://<api-host>
NEXT_PUBLIC_WS_URL=wss://<api-host>
```

Build command:

```bash
npm run build
```

Start command:

```bash
npm run start
```

## Mobile Deployment

The mobile app uses Expo and EAS profiles in `mobile/eas.json`.

```bash
cd mobile
npm run release-check
npx eas build --platform android --profile preview
```

Set mobile variables in the EAS profile or EAS secrets:

```bash
EXPO_PUBLIC_API_URL=https://<api-host>
EXPO_PUBLIC_WS_URL=wss://<api-host>
EXPO_PUBLIC_ENABLE_PUSH_NOTIFICATIONS=true
EXPO_PUBLIC_GEMINI_API_KEY=<demo-only-or-proxy-key>
```

For production, prefer sending mobile AI requests through the backend instead of exposing provider keys in the mobile bundle.

## Environment Variables

Backend:

```bash
NODE_ENV=production
PORT=8080
CORS_ORIGIN=https://<web-host>
PROCESS_TYPE=web
ENABLE_DATABASE=true
ENABLE_REDIS=true
ENABLE_QUEUES=true
ENABLE_WEBSOCKET=true
ENABLE_SCHEDULER=true
DATABASE_URL=<production-postgres-url>
DIRECT_URL=<production-postgres-url>
REDIS_URL=<production-redis-url>
GEMINI_API_KEY=<gemini-key>
DEEPGRAM_API_KEY=<deepgram-key>
JWT_SECRET=<strong-random-secret>
JWT_REFRESH_SECRET=<strong-random-secret>
LOG_LEVEL=info
```

Optional:

```bash
GOOGLE_CLIENT_ID=<oauth-client-id>
GOOGLE_CLIENT_SECRET=<oauth-client-secret>
GOOGLE_REDIRECT_URI=https://<api-host>/api/calendar/callback
```

## Production Checklist

- `NODE_ENV=production` is set.
- `DATABASE_URL` points to a production pgvector-enabled PostgreSQL database.
- `REDIS_URL` points to production Redis and does not use localhost.
- `JWT_SECRET` and `JWT_REFRESH_SECRET` are strong generated values.
- API keys are stored in the platform secret manager.
- `CORS_ORIGIN` is restricted to deployed web/mobile origins.
- Prisma migrations are deployed with `npx prisma migrate deploy`.
- Health endpoint returns success at `/api/health`.
- WebSocket URL uses `wss://`.
- Logs are monitored for API, worker, queue, and database failures.
- No `.env` files or secrets are committed.
