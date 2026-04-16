# SKILL_DEPLOYMENT — EchoMind AI

## Objective
Deploy EchoMind AI safely and repeatably across development, staging, and production environments.

## Deployment Targets
- Frontend: Vercel or equivalent static/serverless hosting
- Backend APIs: containerized Node.js service
- Worker services: background job runner
- Database: PostgreSQL managed instance
- Storage: S3-compatible object storage
- Cache/queue: Redis

## Environment Strategy
- `.env.local` for development
- Staging environment for integration testing
- Production environment with restricted secrets access

## Build and Release Flow
1. Run linting and tests
2. Build frontend and backend artifacts
3. Apply database migrations
4. Deploy backend and workers
5. Deploy frontend
6. Run smoke tests
7. Monitor logs and metrics

## Recommended CI/CD Steps
- Install dependencies
- Type check
- Run tests
- Build artifacts
- Scan for obvious misconfiguration
- Deploy on main branch merge

## Operational Concerns
- Zero-downtime or low-downtime deploys
- Secret rotation
- Rollback strategy
- Health checks
- Queue drain handling

## Monitoring
- API latency
- WebSocket session success rate
- Transcription job success rate
- Memory extraction success rate
- Error budgets and alert thresholds

## Security Checklist
- HTTPS everywhere
- Auth required for protected routes
- Least-privilege access
- Secure secret storage
- Input validation at edge and service layers

## Deployment Checklist
- Confirm environment variables
- Confirm database migrations
- Verify file storage access
- Verify AI service keys
- Run end-to-end smoke test
- Confirm rollback plan

## Suggested Environments
### Local
- Developer sandbox
- Mock AI responses where needed

### Staging
- Real integrations with test data
- Pre-release verification

### Production
- Rate limits, logs, alerts, backups, and retention rules enabled
