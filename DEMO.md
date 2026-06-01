# EchoMind Demo Guide

## Demo Scenario

Show EchoMind as a wearable AI assistant that captures a consultation, extracts useful memories, creates reminders, and supports natural recall later.

Recommended roles:

- Doctor: explains diagnosis, medication, and follow-up.
- Patient: asks clarification questions.
- EchoMind: captures, summarizes, and retrieves the memory.

## Doctor-Patient Use Case

Sample conversation:

```text
Doctor: Your blood pressure is improving, but continue Amlodipine 5 mg every morning.
Doctor: Please book a follow-up appointment next Friday at 10 AM.
Doctor: Avoid excess salt this week and track headaches or dizziness.
Patient: Should I bring my latest blood test report?
Doctor: Yes, bring the report and your home BP readings.
```

Expected extracted memory:

- Title: Blood pressure follow-up consultation
- Category: Health
- Summary: Continue medication, reduce salt, track symptoms, and bring reports to next visit.
- Tags: blood-pressure, medication, follow-up, report

## Reminder Extraction Example

Input:

```text
Book a follow-up appointment next Friday at 10 AM and bring my blood test report.
```

Expected reminder:

```json
{
  "title": "Book follow-up appointment",
  "dueAt": "next Friday 10:00",
  "category": "health",
  "priority": "high",
  "description": "Bring blood test report and home BP readings."
}
```

## Semantic Search Example

Search query:

```text
What medication did the doctor ask me to continue?
```

Expected response:

```text
Continue Amlodipine 5 mg every morning.
```

Search query:

```text
What should I bring to the next appointment?
```

Expected response:

```text
Blood test report and home blood pressure readings.
```

## Queryless Reminder Example

EchoMind can proactively surface reminders without the user searching:

```text
It is Friday morning. You have a health follow-up at 10 AM. Bring your blood test report and BP readings.
```

## Live Demo Flow

1. Start local infrastructure with `docker compose up -d`.
2. Start backend with `npm run dev:server`.
3. Start web with `npm run dev:client`.
4. Start mobile with `npm run dev:mobile`.
5. Open the mobile listener tab and speak the consultation script.
6. Show the extracted memory in the mobile feed or web vault.
7. Open reminders and show the follow-up reminder.
8. Open web search and run the semantic search examples.
9. Close with architecture and future scope from `PROJECT_SUMMARY.md`.
