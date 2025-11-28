# Travelr

Travelr is a personal trip planner with a Node.js + TypeScript API (`server/`) and a lit-based TypeScript client (`client/`). The backend replays slash-command journals to rebuild a `TripModel`, while the frontend will evolve into a column-based UI for inspecting and editing activities.

> **New or returning developer?** Start with `devenvsetup/README.md` to rebuild the Docker-based development environment on Windows before following the steps below.

## Prerequisites

- Node.js 20.9+ (includes npm 10+)
- VS Code optional but recommended for debugging (no Docker required at this stage)

## Getting Started

1. **Install dependencies**

	```powershell
	npm install
	```

2. **Set up the Travelr API keys (Windows Credential Manager only)**

	- Install Python 3.x if needed, then `pip install keyring`.
	- In a Python REPL, store each secret under the TRAVELR service:
		```python
		import keyring
		SERVICE = "TRAVELR"
		keyring.set_password(SERVICE, "OPENAI_API_KEY", "sk-...")
		keyring.set_password(SERVICE, "GOOGLE_CS_API_KEY", "AIza...")
		keyring.set_password(SERVICE, "GOOGLE_CS_CX", "programmable-search-id")
		```
	- Confirm the entries exist under **Control Panel → Credential Manager → Windows Credentials → Generic Credentials** with targets `TRAVELR/OPENAI_API_KEY`, `TRAVELR/GOOGLE_CS_API_KEY`, and `TRAVELR/GOOGLE_CS_CX`.
	- Verify OpenAI connectivity any time with `npm run gpt:first-light --workspace server`, which invokes `server/src/gpt.ts`.

3. **Configure Google Custom Search**

	- Create a Programmable Search Engine and enable the “Custom Search API” in the same Google Cloud project as your API key.
	- Copy the Search Engine ID (`cx`) into the credential entry `TRAVELR/GOOGLE_CS_CX` (no environment fallback).
	- The server reads these credentials directly from Windows Credential Manager and logs every API response to `data/last_search_result.html` for inspection.

4. **Run the API (watch mode)**

	```powershell
	npm run dev --workspace server
	```

	This uses `nodemon` + `tsx` to rebuild on change and serves the HTTP API at `http://localhost:4000`.

5. **Run the client (watch mode)**

	```powershell
	npm run dev --workspace client
	```

	Vite serves the lit app at `http://localhost:5173`, proxying `/api` calls to the server.

6. **Type-check and build** (optional sanity checks)

	```powershell
	npm run typecheck --workspace server
	npm run build --workspace server
	npm run build --workspace client
	```

## Project Layout

- `server/` – Express-based API, future journal/parser/reducer modules, outputs to `server/dist/`.
- `client/` – Vite + lit frontend, entry point at `client/index.html` and components under `client/src/`.
- `data/` – Journals (`<tripName>.json`) that the backend replays; the server ensures this directory exists.
- `tsconfig.base.json` – Shared TypeScript compiler defaults for both workspaces.

## Slash Commands

- `/newtrip <tripId>` – Initialize or reset a journal for `tripId`.
- `/add activityType=<type> field=value ...` – Append a new activity (server assigns `uid`).
- `/edit <uid> field=value ...` – Update existing activity fields.
- `/movedate from="YYYY-MM-DD" to="YYYY-MM-DD"` – Move every activity on a date.
- `/undo [count]` – Step backward through the journal timeline without deleting entries. `count` defaults to 1.
- `/redo [count]` – Reapply commands that were previously undone, provided no new commands were recorded after the undo.
- `/trip [tripId]` and `/help` – List trips or show help text.
- `/renormalize` – Maintenance-only command that rewrites every `.travlrjournal` into canonical form, producing `.tmp` files for review. Trigger this manually; AI chat responses must not invoke it.

## Next Steps

- Flesh out slash-command parser and reducer so the API returns authoritative trip models.
- Build initial lit components (`<trip-app>`, day/plan panels) that consume the API.
- Add VS Code launch/debug configuration once the API endpoints stabilize.
