# Telegram echo bot

A Hono webhook that copies incoming Telegram messages back to the same chat. Text, formatting, media and captions are preserved using Telegram's `copyMessage` API. Forum messages stay in their topic. Album items are echoed individually.

## Environment

Requires Node.js 22.15+ and these variables, either in the process environment or a local `.env` file:

```dotenv
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_WEBHOOK_SECRET=your-random-webhook-secret
```

The webhook secret must contain 1-256 letters, digits, underscores or hyphens. Use the same values locally when registering the webhook and on the deployed service. `PORT` is optional and defaults to `3000`.

## Build and check

```sh
npm install
npm run build
npm test
npx hono routes src/app.ts
npx hono request / src/app.ts
```

Tests run webhook requests through Hono CLI with a mocked Telegram API; they do not send Telegram messages or require real credentials. `npm start` runs the built app and loads `.env` when present. The deployment must expose it at a public HTTPS URL.

## Register the webhook

After deploying, register the full endpoint URL:

```sh
npm run webhook:set -- https://your-domain/webhook
```

This calls `setWebhook` with your secret and `allowed_updates: ["message"]`. Registration replaces the bot's previous webhook; it preserves pending updates. Registration is an explicit command, not a startup action.

Open the bot in Telegram and send text, a photo, a sticker or another supported message. `/start` is echoed like any other text. In groups, Telegram privacy mode controls which messages the bot receives.

## Endpoint behavior

- `GET /` returns `hello railway` for health checks.
- `POST /webhook` checks `X-Telegram-Bot-Api-Secret-Token` and returns `401` if it is missing or incorrect, `400` for malformed updates, and `503` if the bot environment is missing.
- New messages are copied back to their source chat. Bot messages, edits, callbacks, service events, invoices, paid media, giveaways and quiz polls with unknown answers are acknowledged without an echo.
- Success returns `200`. Telegram API failures or a 10-second timeout return `502` so Telegram can retry. This simple bot has no persistent deduplication; redelivered updates may produce duplicate echoes.

## API research

Researched with Firecrawl. Direct scraping of `core.telegram.org` was unavailable; Firecrawl's developer index and aiogram's API reference supplied the relevant contracts:

- [`setWebhook`](https://core.telegram.org/bots/api#setwebhook): HTTPS JSON POST delivery, secret header and retries for non-2xx responses. [Retrieved reference](https://docs.aiogram.dev/en/latest/api/methods/set_webhook.html).
- [`copyMessage`](https://core.telegram.org/bots/api#copymessage): copies content without a forwarding link, preserves captions, and documents unsupported message types. [Retrieved reference](https://docs.aiogram.dev/en/latest/api/methods/copy_message.html).

Local research is saved in `.firecrawl/telegram-set-webhook.md`, `.firecrawl/telegram-copy-message.md` and `.firecrawl/telegram-webhook-search.json` (ignored by Git).
