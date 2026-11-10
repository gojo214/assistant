const token = process.env.TELEGRAM_BOT_TOKEN
const secret = process.env.TELEGRAM_WEBHOOK_SECRET

async function main() {
  if (!token || !secret) {
    throw new Error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in the environment or .env.')
  }
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET must be 1-256 letters, digits, underscores or hyphens.')
  }

  let url
  try {
    url = new URL(process.argv[2])
  } catch {
    throw new Error('Usage: npm run webhook:set -- https://your-domain/webhook')
  }
  if (url.protocol !== 'https:' || url.pathname !== '/webhook' || url.username || url.password || url.hash || url.search) {
    throw new Error('Provide a public HTTPS URL ending in /webhook, without credentials, a query or a fragment.')
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: url.href,
        secret_token: secret,
        allowed_updates: ['message'],
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const result = await response.json()
    if (!response.ok || result?.ok !== true) {
      throw new Error('Telegram rejected webhook registration.')
    }
  } catch {
    // Fetch errors and Telegram response bodies may contain credentials.
    throw new Error('Could not register the webhook. Check your bot token, HTTPS URL and network connection.')
  }

  console.log(`Telegram webhook registered: ${url.href}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
