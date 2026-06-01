# EchoMind Architecture and Workflow Diagrams

## Repository Architecture

```mermaid
flowchart TB
  Repo["EchoMind Repository"]
  Repo --> Mobile["mobile/ Expo React Native"]
  Repo --> Web["client/ Next.js Web"]
  Repo --> Server["server/ Express API"]
  Repo --> Types["packages/types Shared Contracts"]
  Repo --> Context["services/context-extractor FastAPI NLP"]
  Repo --> Docs["docs/ Architecture + Cleanup"]
  Server --> Prisma["Prisma Schema + Migrations"]
  Server --> Queues["BullMQ Queue Modules"]
  Server --> WS["WebSocket Handlers"]
  Server --> AI["server/src/ai Authoritative AI Module"]
  Mobile --> Types
  Web --> Types
  Server --> Types
```

## Runtime System

```mermaid
flowchart LR
  User["User / Patient"] --> Wearable["Wearable or Phone Mic"]
  Wearable --> Mobile["Expo Mobile Listener"]
  Mobile -->|Audio / transcript events| WebSocket["WebSocket Runtime"]
  Mobile -->|REST sync| API["Express API"]
  Web["Next.js Dashboard"] -->|REST| API
  Web -->|Live status| WebSocket
  WebSocket --> MemoryBuilder["Transcript Sync + Memory Builder"]
  API --> MemoryService["Memory Service"]
  API --> ReminderService["Reminder Service"]
  MemoryBuilder --> Gemini["Gemini Extraction"]
  API --> Deepgram["Deepgram STT"]
  MemoryService --> Prisma["Prisma ORM"]
  ReminderService --> Prisma
  Prisma --> Postgres["PostgreSQL + pgvector"]
  API --> BullMQ["BullMQ Queues"]
  BullMQ --> Redis["Redis"]
```

## Doctor-Patient Demo Workflow

```mermaid
sequenceDiagram
  participant Doctor
  participant Patient
  participant Mobile as Mobile Listener
  participant API as Express API
  participant AI as Gemini / STT
  participant DB as PostgreSQL + pgvector
  participant Web as Web Dashboard

  Doctor->>Patient: Consultation and follow-up instructions
  Mobile->>API: Stream transcript/audio session
  API->>AI: Transcribe, summarize, extract reminders
  AI-->>API: Memory, tags, action items, due dates
  API->>DB: Store memory, transcript segments, reminders, embeddings
  Web->>API: Search "What medicine did doctor mention?"
  API->>DB: Semantic/keyword retrieval
  API-->>Web: Relevant memory and reminder
```

## Reminder Extraction Workflow

```mermaid
flowchart TD
  Transcript["Conversation Transcript"] --> Extract["Gemini Memory Extraction"]
  Extract --> Classify["Classify memory category and importance"]
  Extract --> ReminderCheck["Detect due date or commitment"]
  ReminderCheck -->|Reminder found| CreateReminder["Create Reminder record"]
  ReminderCheck -->|No reminder| StoreMemory["Store Memory only"]
  CreateReminder --> NotifyQueue["Notification Queue"]
  NotifyQueue --> Redis["Redis"]
  CreateReminder --> StoreMemory
  StoreMemory --> Postgres["PostgreSQL"]
```

## Semantic Search Workflow

```mermaid
flowchart LR
  Query["User query"] --> API["/api/memories/search"]
  API --> Embed["Embedding Service"]
  Embed --> Vector["pgvector similarity search"]
  API --> Rank["Ranking Engine"]
  Vector --> Rank
  Rank --> Results["Relevant memories, summaries, reminders"]
```

## Deployment Topology

```mermaid
flowchart TB
  MobileBuild["EAS Android Build"] --> UserDevice["User Device"]
  Vercel["Vercel / Next Host"] --> Browser["Faculty Browser"]
  Render["Render / Railway API"] --> ManagedPostgres["Managed PostgreSQL + pgvector"]
  Render --> ManagedRedis["Managed Redis"]
  Render --> Gemini["Google Gemini API"]
  Render --> Deepgram["Deepgram API"]
  Browser --> Vercel
  Browser --> Render
  UserDevice --> Render
```

## Clean Production Structure

```mermaid
flowchart TB
  Core["Production Source"]
  Core --> Server["server/src"]
  Server --> API["routes + controllers"]
  Server --> AI["ai: Gemini, Deepgram, Embeddings, Transcription"]
  Server --> Queues["queues"]
  Server --> WS["websocket"]
  Server --> DB["db + prisma"]
  Server --> Utils["utils"]
  Core --> Mobile["mobile: app, components, hooks, services, lib"]
  Core --> Client["client: app, components, hooks, services, lib"]
  Removed["Removed From Publication Tree"]
  Removed --> OldAI["old AI duplicates"]
  Removed --> Legacy["legacy tooling"]
  Removed --> Proto["prototypes"]
  Removed --> Temp["temp/test artifacts"]
```
