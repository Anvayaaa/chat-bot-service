# chat-bot-service

"Ask Anvaya": the chat assistant for the Anvaya event-management CRM, run as its
own service. The CRM shows the chat (the Island at the top of every page); this
service talks to the AI (Groq) and to the CRM's API **as the signed-in person**.

```
Browser (CRM frontend)
  │ 1. POST /api/v1/assistant/session ──────────► CRM backend (5000)
  │    ◄── 15-minute chat pass (who, company, roles, monthly limit)
  │
  │ 2. POST /v1/chat  (chat pass) ──────────────► chat-bot-service (5100)
  │    ◄── answer streamed as Server-Sent Events      │
  │                                                   ├─► Groq (the AI)
  │                                                   └─► CRM API, with the same chat pass
  │                                                         (read-only, plus 2 confirmed actions)
  │ 3. POST /v1/actions/:id/confirm ────────────► makes the proposed change
```

Ground rules: same permissions as the person · changes only after Confirm ·
no deletes · off until a company admin switches it on.

## Run it locally

You need the CRM backend and frontend running too.

1. `npm install`
2. Copy `.env.example` to `.env` and fill it in. `ASSISTANT_TOKEN_SECRET` must
   match the CRM backend's `.env`.
3. `npm run dev` (port 5100)
4. In the CRM: Admin → Automation → **Assistant** → switch it on, then press **Ctrl J**.

Watch the terminal: every tool the AI decides to use is printed as `[tool] name {inputs}`.

## Tests

`npm test` runs against a throwaway MongoDB and a scripted stand-in for the AI
(no Groq calls). Set `MONGOD_PATH` if `mongod` isn't on your PATH.

## API

All `/v1` routes need `Authorization: Bearer <chat pass>`.

| Route | What it does |
|---|---|
| `GET /health` | Is the service up |
| `POST /v1/chat` | `{ message, conversationId?, page? }` → stream of `meta`, `delta`, `tool`, `action`, `done` / `error` |
| `GET /v1/conversations` | The person's recent chats |
| `GET /v1/conversations/:id` | One chat with its messages and proposals |
| `DELETE /v1/conversations/:id` | Delete a chat |
| `POST /v1/actions/:id/confirm` | Make a proposed change |
| `POST /v1/actions/:id/cancel` | Drop a proposed change |
| `GET /v1/usage` | This month's messages for the company |

## Code map

| Folder | Holds |
|---|---|
| `src/middlewares` | Checking the chat pass |
| `src/llm` | The AI provider (`groq.provider.js`), the agent loop (`runAssistant.js`), the system prompt |
| `src/tools` | What the AI may do: 6 read tools, 2 write tools (which only propose) |
| `src/crm` | Calls to the CRM API |
| `src/routes` | HTTP endpoints |
| `src/models` | Conversation, Message, Action (a proposed change) |
| `src/services` | Monthly usage and per-minute limits |

## Going live (Phase 9)

1. **Secrets**: generate a new `ASSISTANT_TOKEN_SECRET` for production and set it in both
   `.env` files. Use a Groq key that has never been shared.
2. **Database**: a separate database (e.g. `chat_bot_service`), ideally with its own database user.
3. **Proxy** the service under the CRM's domain, e.g. `/assistant/` → `127.0.0.1:5100`.
   Streaming needs buffering off:
   ```nginx
   location /assistant/ {
     proxy_pass http://127.0.0.1:5100/;
     proxy_http_version 1.1;
     proxy_set_header Connection "";
     proxy_buffering off;
     proxy_read_timeout 120s;
   }
   ```
4. **Frontend**: set `VITE_ASSISTANT_URL=/assistant` in the CRM frontend's `.env.production`
   and rebuild. (Left empty, the assistant stays hidden.)
5. **Service**: set `ALLOWED_ORIGINS` to the CRM's address, then
   `pm2 start ecosystem.config.cjs --env production`.
6. **Pilot**: switch it on for one company (Settings → Assistant). Optionally set its
   monthly allowance: `PATCH /api/v1/platform/<tenantId>/assistant { "assistantMonthlyLimit": 500 }`.
7. **Watch** for a week: `pm2 logs chat-bot-service`, and `GET /v1/usage` for message counts.
   Groq's free tier allows only a few requests per minute; move to a paid plan before
   switching on many companies.
