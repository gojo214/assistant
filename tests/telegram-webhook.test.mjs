import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const mock = new URL('./mock-telegram.mjs', import.meta.url).href
const secret = 'test-webhook-secret'
const secretHeader = { 'X-Telegram-Bot-Api-Secret-Token': secret }

function run(args, calls = [], env = {}, input) {
  const result = spawnSync(process.execPath, ['--import', mock, ...args], {
    cwd: root,
    encoding: 'utf8',
    input,
    timeout: 30_000,
    env: {
      ...process.env,
      TELEGRAM_BOT_TOKEN: 'test-bot-token',
      TELEGRAM_WEBHOOK_SECRET: secret,
      TELEGRAM_TEST_CALLS: JSON.stringify(calls),
      ...env,
    },
  })
  assert.ifError(result.error)
  return result
}

function batch(steps, calls = [], env = {}) {
  const result = run(['node_modules/@hono/cli/dist/cli.js', 'batch', '-', 'src/app.ts', '--compact'],
    calls, env, steps.map((step) => JSON.stringify(step)).join('\n'))
  assert.equal(result.status, 0, result.stderr + result.stdout)
  const output = JSON.parse(result.stdout)
  assert.equal(output.ok, true)
  assert.equal(output.data.summary.failed, 0, result.stdout)
  assert.equal(output.data.summary.total, steps.length)
  assert.ok(!result.stderr.includes('test-bot-token'), 'Errors must not expose the bot token')
}

function post(body, status = 200, headers = secretHeader) {
  return { method: 'POST', path: '/webhook', headers, body, expect: { status } }
}

function update(message_id, content, chatId = 123) {
  return { update_id: message_id + 1000, message: { message_id, chat: { id: chatId }, ...content } }
}

function copied(message_id, chatId = 123, extra = {}) {
  return { body: { chat_id: chatId, from_chat_id: chatId, message_id, ...extra } }
}

test('webhook authenticates updates and copies text, media and forum messages through Hono CLI', () => {
  batch([
    { path: '/', expect: { status: 200, body: 'hello railway' } },
    { path: '/__no_such_path__', expect: { status: 404, body: '404 Not Found' } },
    { path: '/webhook', expect: { status: 404 } },
    post(update(1, { text: 'Hello' }), 401, {}),
    post(update(1, { text: 'Hello' }), 401, { 'X-Telegram-Bot-Api-Secret-Token': 'x'.repeat(secret.length) }),
    post(update(1, { text: 'Hello' }), 401, { 'X-Telegram-Bot-Api-Secret-Token': 'short' }),
    post('{broken', 400, { ...secretHeader, 'Content-Type': 'application/json' }),
    post('null', 400, { ...secretHeader, 'Content-Type': 'application/json' }),
    post([], 400),
    post({}, 400),
    post({ update_id: 1, message: { message_id: 1 } }, 400),
    post({ update_id: 2, callback_query: { id: 'callback' } }),
    post({ update_id: 3, edited_message: update(3, { text: 'edit' }).message }),
    post(update(4, { new_chat_members: [{ id: 456 }] })),
    post(update(5, { text: 'Bot message', from: { is_bot: true } })),
    post(update(6, { invoice: { title: 'Invoice' } })),
    post(update(7, { poll: { type: 'quiz' } })),
    post(update(8, { text: 'Hello <b>world</b>!\nनमस्ते 👋' })),
    post(update(9, { text: '/start' })),
    post(update(10, { photo: [{ file_id: 'photo' }], caption: 'Original caption' })),
    post(update(11, { sticker: { file_id: 'sticker' } })),
    post(update(12, { voice: { file_id: 'voice' }, is_topic_message: true, message_thread_id: 42 }, -1001234567890)),
    post(update(13, { text: 'Ordinary reply', message_thread_id: 77 }, -1001234567890)),
    post(update(14, { poll: { type: 'regular' } })),
    post(update(15, { poll: { type: 'quiz', correct_option_ids: [0] } })),
  ], [copied(8), copied(9), copied(10), copied(11), copied(12, -1001234567890, { message_thread_id: 42 }),
    copied(13, -1001234567890), copied(14), copied(15)])
})

test('Telegram failures return 502 so updates can be retried', () => {
  batch([1, 2, 3, 4, 5, 6, 7].map((id) => post(update(id, { text: 'retry' }), 502)), [
    { ...copied(1), status: 500, response: { ok: false } },
    { ...copied(2), status: 429, response: { ok: false, parameters: { retry_after: 1 } } },
    { ...copied(3), response: { ok: false } },
    { ...copied(4), raw: 'not JSON' },
    { ...copied(5), error: true },
    { ...copied(6), timeout: true },
    { ...copied(7), response: null },
  ])
})

test('missing configuration fails closed', () => {
  for (const name of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET']) {
    batch([post(update(1, { text: 'Hello' }), 503)], [], { [name]: '' })
  }
})

test('registration uses the configured secret and subscribes only to messages', () => {
  const url = 'https://example.com/webhook'
  const result = run(['scripts/set-webhook.mjs', url], [{
    method: 'setWebhook',
    body: { url, secret_token: secret, allowed_updates: ['message'] },
    response: { ok: true, result: true },
  }])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Telegram webhook registered/)
})

test('registration rejects invalid inputs without a network request', () => {
  for (const url of ['http://example.com/webhook', 'https://example.com/', 'invalid']) {
    const result = run(['scripts/set-webhook.mjs', url])
    assert.equal(result.status, 1, result.stdout)
    assert.match(result.stderr, /HTTPS URL|Usage:/)
  }
  const result = run(['scripts/set-webhook.mjs', 'https://example.com/webhook'], [], {
    TELEGRAM_WEBHOOK_SECRET: 'invalid secret!',
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /TELEGRAM_WEBHOOK_SECRET must/)
})
