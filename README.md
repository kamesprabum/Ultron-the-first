# Jarvis Control Center

A privacy-conscious, voice-first personal AI control center built with Next.js, Gemini, ElevenLabs, and Convex. The interface deliberately presents unavailable integrations as unconfigured rather than displaying sample data.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Add `GEMINI_API_KEY` to enable the secure `/api/assistant` route. It is never exposed to the browser.

## Services

- **Gemini:** create a Google AI Studio key and set `GEMINI_API_KEY`.
- **ElevenLabs:** create an API key and choose a voice ID; set both ElevenLabs variables. The server-only provider lives in `src/services/voice`.
- **Google:** create a Google OAuth web client, set its client ID and secret, then implement the redirect/callback URLs for your deployment. Request only Calendar, Gmail read-only, and Tasks scopes that you enable.
- **Convex:** run `npx convex dev`, accept the generated deployment values, and place them in `.env.local`. The complete initial schema is in `convex/schema.ts`.

## Architecture

`src/services` holds replaceable external providers; `src/app/api` performs server-side validation and orchestration; `convex` owns realtime persisted state. Add tool adapters under `src/tools` and require confirmation before executing destructive actions. Never let a model write directly to Convex or call Google APIs without server-side validation.

## Current implementation boundary

The dashboard, command palette, keyboard controls, request states, Gemini chat endpoint, ElevenLabs provider, environment contract, and Convex schema are implemented. Google OAuth, tool executors, authentication, and Convex subscriptions require your project credentials and should be added before production use. No mock calendar, task, email, or memory records are used.
