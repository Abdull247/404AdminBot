# WhatsApp / Telegram AI Bot

Node.js WhatsApp and Telegram bot using Baileys, the Telegram Bot API, an OpenAI-compatible AI API, and Neon Postgres for conversation memory.

## Layout

```text
config.json
providers/
telegram.json
platform-link.json
cloudflare.json
sandboxes.json
stickers/
custom-instructions.json
persistence-instructions.json
.env.example
migrations/
src/
  index.js
  ai/
  commands/
  config/
  db/
  memory/
  persistence/
  platforms/
  telegram/
  tools/
  utils/
  whatsapp/
```

- `config.json` holds the default model, fallback policy, system instruction, bot behavior, and memory settings.
- `providers/` holds one folder per AI provider (`provider.json` plus `models/config.json`). `providers/catalog.json` picks the default provider, role routing, and fallback policy.
- `telegram.json` holds Telegram bot behavior, `/` command prefix, polling, owners, and token env refs. Leave `TELEGRAM_BOT_TOKEN` empty to run WhatsApp only.
- `platform-link.json` holds WhatsApp/Telegram handshake settings: command names, code length/charset, token TTL, and one-time session expiry.
- `src/telegram/` talks to Telegram (polling, send, media, reactions). `src/platforms/` stores link tokens and shared sessions.
- `sandboxes.json` holds sandbox backends and which one is active (`default`). Only that sandbox's tools are exposed.
- `stickers/` holds WhatsApp sticker packs: one folder per sticker (webp + `info.json`) and `stickers/config.json` listing them for the model.
- `cloudflare.json` holds the Cloudflare AI provider (account/token env refs) and models by category. `generate_image` uses its `image` models; other model families can be added later.
- `custom-instructions.json` holds always-on identity and creator details injected into every system prompt.
- In groups the bot stays quiet unless it is @mentioned or someone replies to one of its messages. Replies are quoted so the group can follow the thread. The AI is told it is in a group and gets the group name, description, and speaker.
- `.env` holds secrets and connection URLs.
- `migrations/` holds SQL files applied on startup.
- `src/tools/catalog/` holds one folder per tool (`config.json` + `handler.js`).
- `reelix_music` searches tracks, fetches details, and sends the song as an mp3. Default source is Audiomack (`config.json` `bot.reelixMusic`). HMAC credentials go in `REELIX_MUSIC_*`. Public stream redirects live at `GET /misc/stream?trackId=` when `BASE_URL` and `publicStreamEndpoint` are on.
- `personalities/` holds one JSON file per AI personality.
- `write_file` can create `.html`, `.css`, `.js`, `.txt`, `.json`, and `.md` files, send them on WhatsApp or Telegram, then send a short recap.
- `sandbox` runs code and commands in a temporary E2B Linux VM. One sandbox is reused per WhatsApp chat until it is killed or times out.
- `linux_machine` is a persistent InstaBox Linux computer (Debian, `/data` disk, optional desktop). It is available in DMs and groups. `sandboxes.json` picks which one is active.
- `create_agent` starts a persistent background agent when at least one sandbox has `supports_persistence_agent: true`. Jobs, steps, logs, and memories live in Neon. The worker runs in-process so a Render free web service plus `/health` cron still works.

## Setup

Copy `.env.example` to `.env` and fill in:

- Provider env vars named in `providers/<id>/provider.json`. Default is NVIDIA (`NVIDIA_BASE_URL` / `NVIDIA_API_KEY`). Also set `HCNSEC_*`, `AGNES_*`, and `KIRA_*` for fallbacks. Extra keys such as `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `GOOGLE_API_KEY` stay optional.
- `DATABASE_URL`
- `LANGSEARCH_API_KEY`
- `TELEGRAM_BOT_TOKEN` (and optionally `TELEGRAM_ENABLED=true`) if you want Telegram as well as WhatsApp
- `E2B_API_KEY` (if `sandboxes.json` default is `sandbox`)
- `INSTABOX_API_KEY` (if default is `linux_machine`)
- `SCREENSHOTLAYER_API_KEY`
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT` (persistent file storage)
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (image generation)

Edit `config.json` for default model, temperature, and system instruction. Add or toggle providers under `providers/`. Edit `sandboxes.json` to choose the active Linux backend.

Group chat:

- `ignoreGroups: true` (default) means the bot does not answer every group message.
- `respondToMentionsInGroups: true` answers when someone tags / @mentions the bot.
- `respondToRepliesInGroups: true` answers when someone replies to the bot's own message.
- `respondToNameMentionsInGroups: true` answers when the bot's name appears in the text without a tag or reply. It matches the configured name, its auto-derived aliases (like `404bot`, `404 bot`, or the numeric part of the name), and anything listed in `nameAliases`.
- `deriveNameAliases: true` builds those aliases automatically from `bot.name`. Set it to `false` to match only `bot.name` and `nameAliases`.
- `nameAliases: []` adds extra spellings to treat as a call, for example `["404bot", "404 bot", "error404"]`.
- `nameCallPatterns: []` accepts extra case-insensitive regular expressions for full control.
- Group replies quote the triggering message. The model receives group name, description, participant count, and who spoke.
- `reactInGroups: true` lets the bot emoji-react to a tagged or quoted group message (funny, thanks, hype, greetings) and then still reply.

```bash
npm install
npm start
```

Link WhatsApp with either QR or pairing code.

QR (default):

```bash
npm start
```

Scan the QR printed in the terminal.

Pairing code:

Set these in `.env`:

```bash
WHATSAPP_USE_PAIRING_CODE=true
WHATSAPP_PHONE_NUMBER=2348012345678
```

Use digits only, including country code. Then start the bot and enter the printed code on your phone under Linked Devices > Link with phone number.

## AI providers

Providers live in `providers/`, one folder per vendor. The catalog is built for free-tier keys: missing keys are skipped, rate-limited models cool down, and chat plus the persistence agent walk the same fallback chain.

```text
providers/
  catalog.json
  nvidia/
    provider.json
    models/config.json
  hcnsec/
  agnes/
  kira/
  openrouter/
  groq/
  google/
  mistral/
  deepseek/
  together/
  cerebras/
  pollinations/
```

`providers/catalog.json` picks the default provider, role routing (`chat`, `persistence`, `vision`, `summarize`), and fallback policy. `config.json` still holds `ai.defaultModel` and can override `ai.fallback`.

Each provider folder:

- `provider.json` has `id`, `enabled`, `default`, `priority`, `freeTier`, and env specs for `baseUrl` / `apiKey` / `timeoutMs`.
- `models/config.json` lists every model with `enabled` (on/off), `supportFallback`, roles, and a `support` object (`chat`, `tools`, `vision`, `streaming`, `json`, `persistence`).

Fallback order when a call fails (timeout, 429, 5xx, auth, empty choices):

1. Other `supportFallback: true` models on the same provider, by `priority`
2. The next ready provider, using that provider's fallback models
3. Stop after `fallback.maxAttempts` (default 10)

Providers without a required key are skipped. Failed models get a short cooldown (`cooldownMs`, longer for 429 / 401). Set `supportFallback: false` on a model to keep it out of the hop list. Both the main bot and the persistence agent use this chain.

`ai.defaultModel` still picks the first chat model. NVIDIA is the default provider (`mistralai/mistral-large-4-1t-a52b`). Use `providerId/modelId` when two vendors share a name. Owner command `.models` prints the live catalog and fallback order.

Probe enabled models without one-by-one tool calls:

```bash
# NVIDIA_API_KEY / HCNSEC_API_KEY / AGNES_API_KEY / KIRA_API_KEY must be set
bash scripts/probe-nvidia.sh
bash scripts/probe-hcnsec.sh
bash scripts/probe-agnes.sh
bash scripts/probe-kira.sh
bash scripts/probe-providers.sh
```

```json
{
  "id": "openrouter",
  "enabled": true,
  "priority": 90,
  "baseUrl": { "env": "OPENROUTER_BASE_URL", "required": false, "value": "https://openrouter.ai/api/v1" },
  "apiKey": { "env": "OPENROUTER_API_KEY", "required": true }
}
```

```json
{
  "id": "google/gemini-2.0-flash-exp:free",
  "enabled": true,
  "supportFallback": true,
  "roles": ["vision", "chat"],
  "support": {
    "chat": true,
    "tools": true,
    "vision": true,
    "streaming": true,
    "json": true,
    "persistence": false
  }
}
```

Set `support.vision` (also accepts `image_support` / `image_surport`) to `true` so WhatsApp image attachments are downloaded and sent as a vision `image_url` part. If the current chat model has no vision, fallback can hop to a vision model.

## Tools

Tool calling is enabled in `config.json`. Each tool lives in `src/tools/catalog/<tool-name>/`.

`write_file` creates files under `generated/` and sends them as WhatsApp documents. Example: ask for a portfolio and the bot can create `index.html`, `styles.css`, and `script.js`, send those files, then reply with a short "I've finished" recap.

`web_search` uses the LangSearch Web Search API. Set `LANGSEARCH_API_KEY` in `.env`. The bot can look up live information, then answer with source URLs.

`get_datetime` returns the user's local date and time. Simple greetings use `query=greeting` (timezone, date, local time, time of day). Use `query=full` for weekdays, week number, and other calendar details. The bot must not guess the time.

`sandbox` uses the E2B code-interpreter SDK. Set `E2B_API_KEY` in `.env`. The model calls it with an `action` such as `run_code`, `run_command`, `files_write`, `install`, `get_url`, or `kill`. Long sandbox work reacts to the user message with an hourglass, then a check mark when finished. Charts and downloaded files are sent on WhatsApp.

`linux_machine` uses the InstaBox SDK (`@insforge/instabox-sdk`). Set `INSTABOX_API_KEY` and optionally `INSTABOX_API_URL` (default `https://api.instabox.sh`), `INSTABOX_TEMPLATE` (default `agent-browser`), and `INSTABOX_MACHINE_ID` to pin an existing box. Available to every chat, including groups. The machine is persistent: `/data/home` survives pause/stop, and the same box is reused across turns and bot restarts. Actions include `run_command`, `run_code`, filesystem helpers, `get_url` (publish a port), `pause` / `resume` / `stop`, desktop control (`desktop_start`, `desktop_screenshot`, `desktop_stream`), and `snapshot`.

Only one sandbox backend is exposed at a time. Set `"default"` in `sandboxes.json` to `linux_machine` or `sandbox`. The bot tells the model the active type and description.

`list_chats` and `summarize_chat` are owner-only. The bot logs DMs and group messages it sees (even when `ignoreGroups` is true and it does not reply). Ask it to list chats, then summarize a group or pull out facts, people, decisions, and action items. Set `OWNER_NUMBERS` in `.env` (comma-separated, with country code) so only you can use these tools. Summarize reacts with an hourglass, then a check mark.

`react` puts one emoji on the current WhatsApp message. In groups, if someone tags the bot or replies to it with something funny, hype, or grateful, it can react first and then send a text reply.

`send_sticker` sends a WhatsApp sticker from `stickers/`. Each pack is a folder with a `.webp` and `info.json` (`id`, `description`, `whenToUse`, path). `stickers/config.json` lists every pack so the model can pick one. Call `list` to inspect, then `send` with an id such as `my_boss`. After the sticker, the bot still sends a short text reply.

`unwrap_view_once` opens a WhatsApp view-once image and resends it to the same chat as a normal photo. Reply to the view-once image (or send one) and ask the bot to unwrap, open, reveal, save, or resend it, or use the `.unwrap` command. Use `source=quoted` (default) for the message being replied to and `source=current` for the current message. It only works on WhatsApp.

`generate_image` creates an image from a text prompt using the Cloudflare AI provider. Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; models live in `cloudflare.json` (default `@cf/black-forest-labs/flux-1-schnell`). It reacts with an hourglass while running and a picture emoji when done, sends the image on WhatsApp, then stores it in the chat's R2 folder when R2 is configured.

`file_storage` persists files to Cloudflare R2 and remembers them in the database, scoped to the requesting user or group. Set `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, and `R2_ENDPOINT` (plus optional `R2_PUBLIC_URL`). Actions: `upload` (content, base64, or path), `get`, `list`, `delete`. Incoming user files are also stored automatically for the chat.

`create_agent` is only registered when `persistenceAgent.enabled` is true and at least one sandbox in `sandboxes.json` has `supports_persistence_agent: true` (typos `surports_*` also work). The main bot reacts with an hourglass, queues the job, and replies with a job id plus `.agent` / `.agent logs` commands. If a persistent agent is already running (see `persistenceAgent.maxConcurrent`), the tool returns that instance's id, status, task, and check commands instead of starting another. Long tasks that burn more than `tools.handoffAfterRounds` tool rounds on the main bot are handed off automatically.

`screenshot` captures a website with the Screenshotlayer API and sends the image on WhatsApp. Set `SCREENSHOTLAYER_API_KEY` in `.env`. Ask for a screenshot of a URL, optionally full page or a mobile viewport. Capture reacts with an hourglass, then a check mark.

## Custom instructions

`custom-instructions.json` (project root, deploys with git) holds always-on identity, creator, and project knowledge. It is injected into the system prompt on every message, in every chat, under every personality. The bot uses it to answer "who built you", credit the developer, describe their projects accurately, and route bug reports.

```json
{
  "bot": { "name": "Jen404", "type": "...", "identity": "..." },
  "creator": { "name": "Error404", "whatsapp": "...", "portfolio": "...", "github": "...", "about": "..." },
  "instructions": ["always-on rules"],
  "developer_profile": { "...": "specializations, technologies, approach" },
  "projects": { "...": "one entry per project" },
  "technical_preferences": { "...": "..." },
  "response_guidelines": { "...": "tone, creator_questions.default canned answer, ..." }
}
```

How it is rendered into the prompt:

- `bot` and `creator` become the identity header; `response_guidelines.creator_questions.default` becomes the canned "who made you" answer.
- Top-level `instructions` become permanent rules that survive every personality switch.
- Every other top-level section (`developer_profile`, `projects`, `technical_preferences`, `response_guidelines`, and anything new you add later) is rendered generically as readable nested bullets.
- An `instructions` array at any nesting depth becomes a "Keep in mind:" sub-block at that spot, so per-project accuracy rules stay attached to their project.

Notes:

- `bot.name` also feeds @mention detection in groups, alongside `bot.name` in `config.json`. Keep them in sync.
- The rendered block is cached per process; restart (or redeploy) after editing the JSON.
- Missing or invalid file only logs a warning; the bot still starts.
- Personalities in `personalities/` change style. This file changes identity and facts. Both apply together.

## Commands

Messages that start with `.` on WhatsApp or `/` on Telegram are handled before the AI. Same command names on both platforms.

```text
.menu                         /menu
.personalities                /personalities
.personalities - Helpfulness  /personalities - Helpfulness
.agent                        /agent
.agent <id>                   /agent <id>
.agent logs <id>              /agent logs <id>
.agent result <id>            /agent result <id>
.agent cancel <id>            /agent cancel <id>
.link-platform                /link-platform
.link-platform <code>         /link-platform <code>
.unlink-platform              /unlink-platform
.link-status                  /link-status
.unwrap                       (WhatsApp only)
.unwrap current               (WhatsApp only)
```

`.menu` / `/menu` lists commands. `.personalities` lists the JSON configs in `personalities/`. `.personalities - Helpfulness` switches this chat to that personality. The choice is stored per user/chat.

`.agent` / `/agent` manages persistent background jobs for this chat. The command name is `persistenceAgent.command` in `config.json` (default `agent`). Job ids look like `jen-<timestamp>-<token>`. When a job finishes, the bot sends a follow-up on the platform that started it.

## Telegram

Telegram is optional. Enable it with a bot token from [@BotFather](https://t.me/BotFather):

```bash
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_BOT_USERNAME=YourBot
TELEGRAM_OWNER_IDS=123456789
```

`telegram.json` controls prefix (`/`), group mention/reply behavior, typing, owners, and long-poll settings. Commands match WhatsApp: `/menu`, `/personalities`, `/reelix`, `/agent`, plus the link commands below. Groups stay quiet unless the bot is @mentioned, someone replies to it, or its name appears in the text (`respondToNameMentionsInGroups`), same as WhatsApp. `nameAliases` and `nameCallPatterns` come from `config.json`; the Telegram bot's own username and first name are also matched.

## Platform linking

Link a WhatsApp DM to a Telegram DM so Telegram reuses that WhatsApp chat's memory, personality, and history. The model is told the platform changed.

Handshake (one-time code, TTL from `platform-link.json`):

1. On WhatsApp send `.link-platform`. The bot prints `/link-platform Ab3K7N2Q9P`.
2. Send that exact command to the Telegram bot.
3. Or start on Telegram with `/link-platform`. The bot prints `.link-platform Ab3K7N2Q9P` for WhatsApp.

`.link-platfrom` / `/link-platfrom` are aliases. Codes expire (default 10 minutes), are one-time, and each linked session can also be one-time-use with its own expiry (default 7 days). Tweak all of that in `platform-link.json`:

```json
{
  "enabled": true,
  "command": "link-platform",
  "ttlSeconds": 600,
  "oneTime": true,
  "session": {
    "oneTimeUse": true,
    "expiresAfterHours": 168
  }
}
```

`/unlink-platform` and `/link-status` disconnect or inspect the current chat. Linking is DM-only by default.

## Persistent background agent

Long tasks are queued in Neon and run by an in-process worker in the same `npm start` process. That matches a Render free web service: keep hitting `/health` so the process stays awake, and unfinished jobs resume from checkpoints after a restart.

The `create_agent` tool is exposed only when:

1. `persistenceAgent.enabled` is true in `config.json` (or `PERSISTENCE_AGENT_ENABLED` is not `false`)
2. At least one sandbox in `sandboxes.json` has `supports_persistence_agent: true` (also accepts `supportsPersistenceAgent` and the typo `surports_*`)

`linux_machine` ships with that flag on. E2B `sandbox` does not.

```json
{
  "persistenceAgent": {
    "enabled": true,
    "defaultModel": "zai-org/GLM-5.3-Flash",
    "command": "agent",
    "maxRounds": 40,
    "maxRuntimeMinutes": 90,
    "maxConcurrent": 1,
    "workspaceRoot": "/data/home/jen404/agents",
    "allow": ["linux_machine", "sandbox", "web_search", "write_file", "file_storage", "screenshot"]
  }
}
```

`maxConcurrent` is a hard cap on *running* persistent agents (default `1`). When the bot calls `create_agent` while that cap is full, it does not start a second instance. It replies with the running job id, status, task, progress, and the same check/logs commands the user would get from a new job.

`defaultModel` uses the same `providers/` catalog as the main bot, including fallback. Role `persistence` prefers models with `support.persistence` or `roles: ["persistence"]`. If the chosen model has `support.vision`, the persistence agent can inspect attached images through `read_attachment`.

Incoming WhatsApp messages are queued per chat and fairly across chats (`bot.queue` in `config.json`). Up to `maxConcurrentChats` conversations generate replies at once; extra people are told they are waiting instead of colliding. Each chat still runs one request at a time so history stays in order.

WhatsApp files sent with the starting message are stored on the job, copied into the sandbox workspace, and readable via `read_attachment`. Durable job state is written under `/data/home/jen404/agents/<job-id>/` (writable InstaBox home). If that path is not writable, the worker falls back to `/data/home/agents` or `/tmp/jen404/agents`.

Job tables (separate from chat memory):

- `persistence_jobs`
- `persistence_job_steps`
- `persistence_job_logs`
- `persistence_job_memories`
- `persistence_job_files`
- `persistence_job_notifications`

Agent instructions live in `persistence-instructions.json` and in `src/persistence/`. Optional env overrides: `PERSISTENCE_AGENT_ENABLED`, `PERSISTENCE_MAX_CONCURRENT`, `PERSISTENCE_MAX_RUNTIME_MINUTES`, `PERSISTENCE_POLL_MS`, `PERSISTENCE_LEASE_SECONDS`, `PERSISTENCE_WORKER_ID`, `PERSISTENCE_WORKSPACE_ROOT`.

## Scripts

```bash
# start bot
npm start

# restart on file changes
npm run dev

# run SQL migrations only
npm run migrate
```

## Deploy on Render

Two supported service types. Both run the same code; the bot switches modes from env vars alone.

| Type | When to use | What you need |
| --- | --- | --- |
| **Web Service** (free tier works) | Default choice. Renders a health endpoint on `$PORT`. | Nothing extra; pair the bot once from your phone. |
| **Background Worker** (paid) | If you want the session on a persistent disk instead of Postgres. | Persistent disk + instance that never spins down. |

### Web Service mode (recommended)

Set the environment variable `PORT` (Render injects it automatically, but you can also pin it). The bot then:

- starts a tiny HTTP server on `$PORT` serving `GET /`, `/health`, and `/ping` with JSON status (`whatsapp` connection state and `jid` included), plus `POST /reelix/send` for the Reelix group notify;
- defaults `WHATSAPP_AUTH_STORE=postgres`, so the WhatsApp session lives in Neon instead of the ephemeral disk and survives deploys and restarts.

Free web services sleep after ~15 minutes of no inbound HTTP. The WhatsApp socket does not count as activity, so it is strongest to keep a free pinger (UptimeRobot, cron-job.org, etc.) hitting `/health` every 5-10 minutes.

Settings:

```text
Name: error404-whatsapp-bot
Region: closest to you
Branch: main
Root Directory: (leave empty)
Runtime: Node
Build Command: npm install
Start Command: npm start
Health Check Path: /health
```

No persistent disk is required in this mode. `TOOLS_OUTPUT_DIR` is still ephemeral, which is fine for disposable generated files.

### Background Worker mode

A Background Worker gets no `PORT`, the HTTP server stays off, and the session defaults to `WHATSAPP_AUTH_STORE=file`. It keeps a WhatsApp socket open with no inbound traffic.

Use a **paid** instance so Render does not spin it down. Add a persistent disk:

```text
Name: whatsapp-data
Mount Path: /data
Size: 1 GB
```

Then set:

```text
WHATSAPP_SESSION_DIR=/data/session
TOOLS_OUTPUT_DIR=/data/generated
```

Without this, every deploy or restart wipes `./session` and the bot logs out.

### Create the service

1. New > Background Worker.
2. Connect this GitHub repo.
3. Runtime: **Node**.
4. Instance: a paid plan (Starter or higher). Do not use a free web service.
5. Settings:

```text
Name: error404-whatsapp-bot
Region: closest to you
Branch: main
Root Directory: (leave empty)
Runtime: Node
Build Command: npm install
Start Command: npm start
```

Set the Node version to 18 or newer. In the Render dashboard add:

```text
NODE_VERSION=20
```

Or add an `.node-version` / `NODE_VERSION` env var. `package.json` requires `>=18.18.0`.

### Persistent disk

Baileys stores the WhatsApp session on disk. If that folder is lost, you have to link the phone again.

On the paid worker, add a persistent disk:

```text
Name: whatsapp-data
Mount Path: /data
Size: 1 GB
```

Then set:

```text
WHATSAPP_SESSION_DIR=/data/session
TOOLS_OUTPUT_DIR=/data/generated
```

Without this, every deploy or restart wipes `./session` and the bot logs out.

### Environment variables

In Render > Environment, add the same keys as `.env.example`. Do not upload a `.env` file.

Required:

```text
NVIDIA_BASE_URL
NVIDIA_API_KEY
DATABASE_URL
```

WhatsApp linking (pairing code, recommended on Render):

```text
WHATSAPP_USE_PAIRING_CODE=true
WHATSAPP_PHONE_NUMBER=2348012345678
WHATSAPP_PRINT_QR=false
OWNER_NUMBERS=2348012345678
```

Session and health (only what differs from the defaults):

```text
WHATSAPP_SESSION_DIR=/data/session  # Worker mode with a disk only
WHATSAPP_AUTH_STORE=postgres         # omit to auto-detect from PORT
PORT=10000                            # Web Service only, usually injected
HOST=0.0.0.0
HEALTH_SERVER=true                    # optional: listen on 10000 without PORT
```

Use digits only, with country code, no `+` or spaces.

Optional tools:

```text
LANGSEARCH_API_KEY
E2B_API_KEY
INSTABOX_API_KEY
INSTABOX_API_URL
INSTABOX_TEMPLATE
INSTABOX_MACHINE_ID
SCREENSHOTLAYER_API_KEY
SCREENSHOTLAYER_SECRET
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
R2_ENDPOINT
R2_PUBLIC_URL
R2_ACCOUNT_ID
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

Useful extras:

```text
LOG_LEVEL=info
CONFIG_PATH=./config.json
SANDBOXES_PATH=./sandboxes.json
STICKERS_PATH=./stickers/config.json
CLOUDFLARE_CONFIG_PATH=./cloudflare.json
DEFAULT_TIMEZONE=Africa/Lagos
AI_TIMEOUT_MS=60000
E2B_TIMEOUT_MS=300000
INSTABOX_API_URL=https://api.instabox.sh
INSTABOX_TEMPLATE=agent-browser
INSTABOX_MACHINE_ID=
WHATSAPP_MAX_STALE_MS=600000
```

Reelix streaming group (WhatsApp):

```text
REELIX_GROUP_JID=120363XXXXXXXXXX@g.us
REELIX_RESTRICT_ACCESS=true
REELIX_SEND_KEY=
REELIX_ADMIN_NUMBERS=2348012345678
OWNER_NUMBERS=2348012345678
```

`REELIX_GROUP_JID` is the WhatsApp group the scheduler posts new titles into (digits`@g.us`, or just the numeric id). On connect the bot logs every group it is in as `WhatsApp group "<name>" jid=...@g.us`; copy that `jid` here. A message in a not-yet-listed group also prints the same line once. `REELIX_RESTRICT_ACCESS=true` makes the bot answer only that group plus owner/admin DMs (`OWNER_NUMBERS` / `REELIX_ADMIN_NUMBERS`); Telegram only answers `TELEGRAM_OWNER_IDS`. `REELIX_SEND_KEY` authenticates `POST /reelix/send`.

`WHATSAPP_MAX_STALE_MS` drops messages older than this many milliseconds (default 10 minutes). Raise it if a sleeping free-tier host wakes up and you still want it to answer the backlog; lower it if the bot replies to very old group chatter.

`config.json` is in the repo, so model/personality settings deploy with git. Secrets stay in Render env vars.

### First boot / link WhatsApp

1. Deploy the service.
2. Open **Logs**.
3. Wait for a pairing code line such as `WhatsApp pairing code ready`.
4. On your phone: Linked Devices > Link with phone number > enter the code.
5. After `WhatsApp connected`, leave the service running. `GET /health` should report `"whatsapp":"open"`.

If the session is already stored (Postgres rows or the persistent disk), later deploys reconnect without a new code.

Do not use QR login on Render unless you can read the ASCII QR in logs. Pairing code is the reliable path.

### What not to deploy it as

- **Static Site**: there is no frontend build to host.
- **Cron Job**: the WhatsApp socket must stay open, not run once and exit.
- **Private Service**: works technically, but nothing else in this repo needs to call the health endpoint over HTTP, so there is no reason to pick it over a Web Service.

### After deploy

- Migrations run on startup (`runMigrations` in `src/index.js`). You do not need a separate migrate step. This includes `004_whatsapp_auth.sql`, which creates the `whatsapp_auth` table for the Postgres session store.
- Scale to **1 instance**. Two instances with the same session will fight over the WhatsApp link.
- Health check: `GET /health` (or `/ping`) returns `{"ok":true,"whatsapp":"open","jid":"...","uptime":...}` when connected.
- Reelix group send: `POST /reelix/send` (alias `/reelix/notify`) with `X-Reelix-Send-Key`. Body is `{ kind, newCount, items: [{ subjectId, title, coverUrl, description, ... }], text?, coverUrl?, jid? }`. The bot composes a structured WhatsApp message (cover + name + details) and sends it to `REELIX_GROUP_JID`. No AI chat call. Admins can also trigger this through the proxy `POST /admin/bot/send`.
- Worker mode: if the bot stops answering, check logs for disconnects, then confirm the persistent disk still has `/data/session`.
- Web Service mode: the session is in Neon, so a lost link is not about disk. To relink, clear the `whatsapp_auth` rows (or set `WHATSAPP_AUTH_STORE=file` locally) and restart. A new pairing code will print in logs.
