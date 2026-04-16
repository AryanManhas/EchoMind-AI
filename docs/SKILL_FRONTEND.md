# SKILL_FRONTEND — EchoMind AI

## Objective
Build a clean, futuristic frontend for the EchoMind AI experience with two surfaces:
- Expo mobile capture app
- Next.js dashboard vault

## Frontend Principles
- Minimal and premium visual design
- Strong use of motion and feedback
- Fast capture flow with low cognitive load
- Clear visual states for recording and processing
- Search-first vault layout

## Core Screens
### Capture Screen
- Neural Orb visualization
- Record / pause / stop controls
- Live transcript preview
- Status chips for listening, streaming, processing, saved

### Memory Vault
- Search bar
- Filter chips by memory type
- Timeline or card layout
- Memory detail drawer/modal

### Memory Detail
- Transcript
- AI summary
- Extracted structured fields
- Tags
- Actions: edit, archive, delete

## UI Components
- OrbVisualizer
- RecordingButton
- AudioLevelBar
- TranscriptStream
- MemoryCard
- SearchInput
- FilterPills
- DetailPanel

## Styling Direction
- Dark futuristic theme
- Soft glow accents
- Glassmorphism where appropriate
- Rounded corners with strong spacing
- Typographic hierarchy with bold headings and readable body text

## Interaction Rules
- Immediate feedback on mic state
- Smooth transitions between capture states
- Skeleton loaders for processing
- Empty states that explain next action
- Error states that feel helpful, not technical

## Accessibility
- High contrast text
- Keyboard navigation on web
- Screen reader labels for controls
- Reduced motion fallback
- Sufficient tap targets

## Performance Targets
- Capture UI should feel instantaneous
- Dashboard search should remain responsive
- Avoid heavy animations that block interaction
- Lazy-load non-critical panels

## Frontend Implementation Notes
- Use shared types from backend contracts
- Keep UI state separate from server state
- Prefer component composition over large page files
- Use optimistic updates for edits when safe

## Deliverable Checklist
- Responsive mobile capture UI
- Responsive web vault UI
- Reusable component library
- Loading, error, and empty states
- Search and filter experience
- Polished futuristic theming
