# SKILL_BACKEND — EchoMind AI

## Objective
Build a reliable backend that accepts live audio streams, transcribes speech, extracts memories, and serves the vault API.

## Backend Responsibilities
- Authentication and user/session management
- WebSocket audio ingestion
- Audio buffering and storage
- Transcription orchestration
- Structured memory extraction
- Memory search and CRUD APIs
- Observability and error handling

## Suggested Service Boundaries
### API Gateway
- REST endpoints for dashboard and administration
- Session initialization
- Memory CRUD
- Search endpoints

### WebSocket Service
- Real-time audio ingestion
- Chunk validation
- Stream session tracking
- Backpressure handling

### Processing Worker
- Whisper transcription jobs
- Gemini extraction jobs
- Post-processing and normalization

## Data Contracts
### Transcript Result
- session_id
- transcript_text
- segments
- confidence
- duration

### Memory Result
- title
- summary
- type
- tags
- action_items
- source_transcript
- confidence

## Validation Rules
- Reject malformed sessions
- Validate payload sizes
- Sanitize all user content
- Enforce schema checks on AI outputs
- Prevent duplicate memory writes

## Error Handling
- Retry transient upstream failures
- Mark failed sessions explicitly
- Store partial results where possible
- Return actionable error messages to client

## Security
- JWT or session-based auth
- Rate limiting
- Input and output validation
- Secret isolation
- Encrypted data transport

## Storage Considerations
- Store only what is needed
- Separate raw audio and derived memory data
- Use timestamps and indexes for search performance
- Support archival or deletion policies

## Observability
- Correlation IDs
- Structured logs
- Latency measurements for each stage
- Retry and failure counters
- Processing queue visibility

## Backend Delivery Checklist
- Audio WebSocket endpoint
- Transcription integration
- Memory extraction integration
- Search and CRUD APIs
- Database migrations
- Monitoring and safe error handling
