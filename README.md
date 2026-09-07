# PI-CHAT GATEWAY

[Download the pre-built executable for your operating system](executables/README.md)

A lightweight, self-hosted intranet web server that manages multi-chat sessions (ChatGPT/Gemini style UI), handles dynamic model selection across multiple LLM backends (Ollama / `llama.cpp`), and automatically manages context window limits per request.

Optimized for the **Raspberry Pi Zero W** (ARMv6, 512MB RAM) — single Go binary, no Node.js, no Docker, no Python.

---

## Features

- **Multi-Conversation Sidebar** — ChatGPT/Gemini style left panel with New/Rename/Delete chat actions, ordered by recent activity.
- **Per-Conversation Settings** — Provider, Model, System Prompt, and Sliding Context Window (N turns) saved per thread.
- **Dynamic Provider Endpoints** — Add/remove multiple LLM backends (Ollama or llama.cpp) on your home network.
- **API Key Support** — Optional per-provider API key for online/cloud Ollama endpoints; sent as `Authorization: Bearer <key>` and masked in the UI.
- **Model Auto-Discovery** — Fetches available models on demand via `GET /v1/models` (llama.cpp) or `GET /api/tags` (Ollama).
- **Sliding Context Window** — Before sending a request upstream, history is pruned to `[System Prompt] + Last N user/assistant turns`, preventing KV-cache exhaustion on the target server.
- **Voice (Narrator Mode)** — Optional text-to-speech using Microsoft Edge's online TTS service. Toggle with the 🔊 button in the settings bar or by sending "voice", "voice on", or "voice off" as a chat message. When enabled, assistant replies are spoken aloud in the browser.
- **Zero External Runtime Dependencies** — Frontend (HTML/CSS/JS) embedded directly into the Go binary via `//go:embed`.
- **Flat-File JSON Persistence** — No CGO, no SQLite driver needed. Data stored as JSON files on the SD card.

---

## Project Structure

```
pi-chat-gateway/
├── cmd/server/main.go          # Entry point
├── internal/
│   ├── db/
│   │   ├── models.go           # Data models (Provider, Settings, Message, Conversation)
│   │   └── jsonstore.go        # Flat-file JSON persistence
│   ├── llm/
│   │   ├── client.go           # Upstream LLM client + context sliding
│   │   └── client_test.go      # Unit tests for context sliding & API parsing
│   ├── server/
│   │   └── server.go           # HTTP API server
│   └── voice/
│       └── voice.go            # Text-to-speech (narrator mode) via Edge TTS
├── web/
│   ├── embed.go                # //go:embed static assets
│   └── static/
│       ├── index.html          # SPA shell
│       ├── style.css           # ChatGPT-style dark theme
│       └── app.js              # Frontend logic
├── go.mod
└── README.md
```

---

## Pre-built Executables

Ready-to-run binaries for all supported platforms are in the [`executables/`](executables/README.md) folder, organized by OS/architecture — see [executables/README.md](executables/README.md) for download links and per-platform instructions.

To rebuild all of them from source, run `build_all.bat` or `build_all.ps1` inside the `executables/` folder.

---

## Build

### Local (Windows / macOS / Linux)

```bash
go build -o pi-chat-gateway ./cmd/server
```

### Raspberry Pi Zero W (ARMv6)

```bash
GOOS=linux GOARCH=arm GOARM=6 go build -o pi-chat-gateway ./cmd/server
```

Copy the single binary to the Pi:

```bash
scp pi-chat-gateway pi@<pi-ip>:~/
```

---

## Run

```bash
./pi-chat-gateway -addr :8080 -data ./data
```

| Flag     | Default   | Description                          |
|----------|-----------|--------------------------------------|
| `-addr`  | `:8080`   | HTTP listen address                  |
| `-data`  | `./data`  | Directory for JSON storage           |

Then open `http://<pi-ip>:8080` in a browser.

---

## API Endpoints

| Method | Path                          | Description                                    |
|--------|-------------------------------|------------------------------------------------|
| GET    | `/`                           | Serves the embedded single-page app           |
| GET    | `/api/providers`              | List configured LLM backends                  |
| POST   | `/api/providers`              | Add/update a provider endpoint                |
| DELETE | `/api/providers/{id}`         | Delete a provider                             |
| GET    | `/api/models?provider_id={id}`| Fetch available models from target LLM        |
| GET    | `/api/system-prompts`         | List named system prompts                     |
| POST   | `/api/system-prompts`         | Add/update a named system prompt              |
| DELETE | `/api/system-prompts/{id}`    | Delete a named system prompt                  |
| GET    | `/api/settings`               | Get global app settings (default prompt ID)   |
| PUT    | `/api/settings`               | Save global app settings                      |
| GET    | `/api/conversations`          | List conversation threads (titles + IDs)      |
| POST   | `/api/conversations`          | Create a new conversation thread              |
| DELETE | `/api/conversations`          | Delete ALL conversation threads               |
| GET    | `/api/conversations/{id}`     | Fetch full history + settings for a thread    |
| PUT    | `/api/conversations/{id}`     | Update title / settings / messages            |
| DELETE | `/api/conversations/{id}`     | Delete a conversation thread                  |
| GET    | `/api/voice`                  | Get current voice (narrator mode) setting     |
| PUT    | `/api/voice`                  | Set/toggle voice setting (`{"voice": true}`)  |
| POST   | `/api/chat`                   | Send message, apply context sliding, proxy    |

---

## Data Storage Layout

```
data/
├── providers.json              # All configured LLM backends
├── system_prompts.json         # Named, reusable system prompts
├── settings.json               # Global app settings (default prompt ID)
└── conversations/
    └── <conversation-id>.json  # One file per chat thread
```

---

## Conversation Modes and Context Sliding

Each conversation can use either `Chat` mode, which sends both user and
assistant messages, or `Story` mode, which sends assistant responses and the
current user message. The `Return sends` application setting controls whether
Enter submits the message; when disabled, use Ctrl+Enter or the Send button.

Before each upstream request, the backend builds:

```
Payload = [System Prompt] + Last N user/assistant turns
```

Where `N` is the per-conversation `max_turns` setting (default 12). This keeps payloads bounded so `llama.cpp` / Ollama servers don't run out of KV-cache memory or fail on context limits.

---

## Testing

```bash
go test ./...
```

Tests cover:
- Context sliding truncation (system + last N turns)
- No-system-prompt behavior
- Ollama API path & response parsing
- llama.cpp OpenAI-compatible path & response parsing
- API key `Authorization` header on chat & model discovery
- API key masking & preservation on provider save
- Voice toggle API endpoints
- Voice toggle via chat message ("voice", "voice on", "voice off")

---

## Memory Footprint

- Single Go binary (~9MB on disk)
- JSON flat-file storage (no SQLite driver loaded)
- No external runtimes
- Well under the **30MB RAM** target under active use