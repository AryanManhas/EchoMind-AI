# EchoMind AI — Product Requirements Document (PRD)

## 1. Overview
EchoMind AI is a high-performance, neural-inspired “Second Brain” that captures spoken information in real time, transcribes it, extracts structured memories, and stores them in a searchable vault.

The product connects a mobile/web capture experience with an intelligent backend pipeline:
- capture audio streams
- stream to server over WebSockets
- transcribe speech to text using Whisper
- extract structured memories using Gemini-powered reasoning
- store, search, and act on the generated memories in a dashboard

## 2. Problem Statement
People forget important thoughts, tasks, and ideas spoken throughout the day. Existing note-taking tools require manual effort and do not automatically convert raw speech into actionable knowledge.

## 3. Goals
- Capture spoken thoughts with minimal friction.
- Convert speech into accurate, structured text.
- Automatically classify information into meaningful memory types.
- Provide a fast, elegant vault for search, recall, and action.
- Make the system feel alive, responsive, and futuristic.

## 4. Target Users
- Students
- Founders and knowledge workers
- Creators and researchers
- Users who think out loud and want an AI memory companion

## 5. Core User Stories
1. As a user, I can press record and speak naturally.
2. As a user, I can see live capture feedback through the Neural Orb.
3. As a user, I can receive transcribed text after speaking.
4. As a user, I can have my speech converted into tasks, facts, or ideas automatically.
5. As a user, I can search across all stored memories.
6. As a user, I can revisit the original transcript and extracted memory.
7. As a user, I can manage, edit, and delete memories.

## 6. Functional Requirements
### Capture
- Audio recording from mobile app and web interface
- Real-time waveform/orb visualization
- Pause, resume, stop, and cancel recording
- Automatic chunking/streaming support

### Processing
- Stream audio to backend via WebSockets
- Run speech-to-text transcription
- Generate structured memory objects
- Tag memories with type, timestamp, confidence, and source

### Memory Vault
- Store memory items in a database
- Search by keyword, type, date, and tags
- Filter by Tasks, Facts, Creative Ideas
- Show transcript, summary, and metadata
- Support edit/delete/archive

### Intelligence Layer
- Extract entities, intentions, deadlines, and themes
- Identify action items
- Detect recurring topics and patterns
- Support future summarization and recall features

## 7. Non-Functional Requirements
- Low-latency streaming pipeline
- Secure authentication and data handling
- Scalable backend services
- Reliable storage and retrieval
- Modern responsive UI
- Strong observability and error handling

## 8. Success Metrics
- Capture-to-transcript time
- Memory extraction accuracy
- Search success rate
- User retention
- Number of memories created per session
- Reduction in manual note-taking effort

## 9. Out of Scope for MVP
- Voice cloning
- Multi-user collaboration
- Cross-device offline sync
- Advanced agentic automation
- Full semantic knowledge graph

## 10. MVP Deliverables
- Expo mobile capture app
- Next.js web dashboard
- WebSocket backend
- Whisper transcription service
- Gemini-based memory extraction service
- Database-backed memory vault

## 11. Risks
- Audio quality variability
- Latency in streaming and processing
- Hallucinated or misclassified memory extraction
- Privacy and data protection concerns

## 12. Assumptions
- Users will grant microphone permission.
- Backend can access transcription and LLM services.
- Structured memory categories will be enough for the initial version.

## 13. Future Enhancements
- Semantic timeline view
- Daily/weekly memory digest
- Smart reminders
- Cross-note linking
- Personal memory embeddings and long-term recall
