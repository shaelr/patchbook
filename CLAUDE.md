# Patchbook

Web app that replaces a per-show Excel sheet for Blackmagic ATEM / Videohub input-output labels and equipment IP addresses. A Node server (Mac for development, dedicated Raspberry Pi 4B for production) serves the UI to Mac/iPad browsers, stores projects, and controls the hardware. Full plan: [PLAN.md](PLAN.md).

## Status

Planning complete. No code yet. Next: Phase 1 project skeleton and model catalog.

## Key decisions

- Browsers can't open raw TCP/UDP, so all hardware control goes through the server.
- One optional ATEM and one optional Videohub per project; they are independent (no routing tracking).
- ATEM labels have long (20 char) and short (4 char) names; Videohub labels have one name.
- Network table is device name + IP only, with default IP ranges by role (see PLAN.md).
- Device connections are on demand: connect, read/write, disconnect. ATEM connection slots are limited and Bitfocus Companion holds one.
- Production Pi is separate from the Companion Pi. Server port 3000 (Companion uses 8000).

## Stack

Node.js 24 LTS + TypeScript, Fastify, SQLite, React + Vite, `atem-connection`, `exceljs`.

## Layout

- `server/` — API, storage, device clients (planned)
- `web/` — React UI (planned)
- `shared/` — types and the ATEM / Videohub model catalog (planned)

## Conventions

- The repo is public. Never commit real show files (`.xlsx` in the project root are gitignored); use sanitized fixtures for tests.
- Keep this file up to date when decisions, status, layout, or commands change.
