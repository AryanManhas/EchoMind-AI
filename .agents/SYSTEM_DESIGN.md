# EchoMind AI — System Design

## 1. Architecture Summary
EchoMind AI uses a streaming architecture:
Client Capture Layer -> WebSocket Gateway -> Processing Services -> Database -> Dashboard

## 2. High-Level Components
### Client Applications
- Expo mobile app
- Next.js web app

### Backend Services
- WebSocket audio gateway
- Transcription service
- Memory extraction service
- Search API
- Authentication service

### Data Layer
- Relational database for users, sessions, memories, and tags
- Object storage for raw audio, if retained
- Cache for hot queries and session state

## 3. Data Flow
1. User taps record in the app.
2. Audio is captured in real time.
3. Audio chunks are streamed to the backend through WebSockets.
4. Backend assembles or forwards the stream to transcription.
5. Whisper generates transcript text.
6. Gemini-powered logic extracts structured memories.
7. Results are stored in the database.
8. Dashboard reads memories through an API and renders them in the vault.

## 4. Core Data Model
### Memory
- id
- user_id
- source_type
- transcript
- summary
- memory_type
- tags
- confidence
- created_at
- updated_at

### Memory Types
- Task
- Fact
- Creative Idea

### Session
- id
- user_id
- status
- started_at
- ended_at
- audio_status
- transcript_status
- extraction_status

## 5. Service Responsibilities
### Audio Gateway
- Accept audio streams
- Validate sessions
- Forward chunks to processing pipeline
- Handle reconnects and backpressure

### Transcription Service
- Convert speech to text
- Return transcript segments
- Mark low-confidence sections when needed

### Memory Extraction Service
- Convert transcript into structured memory JSON
- Assign categories and tags
- Produce action items and summaries

### Vault API
- Search memories
- Retrieve memory details
- Update metadata
- Archive/delete memories

## 6. Reliability Concerns
- Network interruptions during streaming
- Large audio payload handling
- Partial transcription failures
- LLM extraction inconsistencies
- Rate limits and retries

## 7. Security Considerations
- Authenticated access to sessions and memories
- Encrypted transport
- Input validation on every service boundary
- Secure secret handling
- Least-privilege service permissions

## 8. Scalability Considerations
- Stateless API workers
- Queue-based processing for long audio
- Horizontal scaling for transcription workloads
- Cached search indices for frequent queries

## 9. Observability
- Structured logs
- Request tracing
- Error tracking
- Processing latency metrics
- Memory extraction quality metrics

## 10. Recommended Tech Stack
- Frontend: Next.js, React, Tailwind CSS
- Mobile: Expo / React Native
- Backend: Node.js, Fastify or NestJS
- Streaming: WebSockets
- Database: PostgreSQL
- Cache/Queue: Redis
- Storage: S3-compatible object storage
- AI Services: Whisper, Gemini
- Deployment: Docker, Vercel, AWS/GCP-compatible hosting
