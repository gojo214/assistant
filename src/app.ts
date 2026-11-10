import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'

const app = new Hono()

const copyableContent = [
  'text', 'animation', 'audio', 'document', 'photo', 'sticker', 'story',
  'video', 'video_note', 'voice', 'contact', 'dice', 'game', 'poll',
  'venue', 'location', 'checklist',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

app.get('/', (c) => {
  return c.text('hello railway')
})

app.post('/webhook', async (c) => {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET

  if (!token || !secret) {
    return c.json({ error: 'Telegram bot is not configured' }, 503)
  }

  const suppliedSecret = Buffer.from(c.req.header('X-Telegram-Bot-Api-Secret-Token') ?? '')
  const expectedSecret = Buffer.from(secret)
  if (suppliedSecret.length !== expectedSecret.length || !timingSafeEqual(suppliedSecret, expectedSecret)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  let update: unknown
  try {
    update = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  if (!isRecord(update) || !Number.isSafeInteger(update.update_id)) {
    return c.json({ error: 'Invalid Telegram update' }, 400)
  }

  // Only new messages are echoed; edits, callbacks and membership updates are acknowledged.
  if (update.message === undefined) return c.json({ ok: true })

  const message = update.message
  if (!isRecord(message) || !Number.isSafeInteger(message.message_id) ||
      !isRecord(message.chat) || !Number.isSafeInteger(message.chat.id)) {
    return c.json({ error: 'Invalid Telegram message' }, 400)
  }

  // Service messages, invoices, paid media and giveaways cannot be copied.
  if ((isRecord(message.from) && message.from.is_bot === true) ||
      !copyableContent.some((field) => message[field] !== undefined && message[field] !== null)) {
    return c.json({ ok: true })
  }

  // Telegram can copy quiz polls only when the bot knows the correct answer.
  if (isRecord(message.poll) && message.poll.type === 'quiz' &&
      !Number.isSafeInteger(message.poll.correct_option_id) &&
      !(Array.isArray(message.poll.correct_option_ids) && message.poll.correct_option_ids.length > 0)) {
    return c.json({ ok: true })
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/copyMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: message.chat.id,
        from_chat_id: message.chat.id,
        message_id: message.message_id,
        ...(message.is_topic_message === true && Number.isSafeInteger(message.message_thread_id)
          ? { message_thread_id: message.message_thread_id }
          : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    })

    const result: unknown = await response.json()
    if (!response.ok || !isRecord(result) || result.ok !== true) {
      console.error('Telegram copyMessage failed', { status: response.status })
      return c.json({ error: 'Failed to echo message' }, 502)
    }
  } catch {
    // Do not log fetch errors: their URLs can contain the bot token.
    console.error('Telegram copyMessage request failed')
    return c.json({ error: 'Failed to echo message' }, 502)
  }

  return c.json({ ok: true })
})

export default app
