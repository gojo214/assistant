import assert from 'node:assert/strict'

const expectedCalls = JSON.parse(process.env.TELEGRAM_TEST_CALLS ?? '[]')
let callCount = 0
let assertionFailure

// Preloaded only in test child processes. Every fetch is intercepted; no network is used.
globalThis.fetch = async (url, options) => {
  const expected = expectedCalls[callCount++]
  try {
    assert.ok(expected, 'Unexpected Telegram request')
    assert.equal(url, `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${expected.method ?? 'copyMessage'}`)
    assert.equal(options.method, 'POST')
    assert.equal(new Headers(options.headers).get('content-type'), 'application/json')
    assert.deepEqual(JSON.parse(options.body), expected.body)
    assert.ok(options.signal instanceof AbortSignal, 'Telegram requests must have a timeout signal')
  } catch (error) {
    assertionFailure ??= error
    throw error
  }

  if (expected.error) throw new Error(`Simulated network failure for ${url}`)
  if (expected.timeout) throw new DOMException('Request timed out', 'TimeoutError')
  const response = Object.hasOwn(expected, 'response') ? expected.response : { ok: true, result: { message_id: 999 } }
  return new Response(expected.raw ?? JSON.stringify(response), {
    status: expected.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

process.on('exit', () => {
  // Assertions inside fetch may be caught by the app; still fail the test process.
  assert.ifError(assertionFailure)
  assert.equal(callCount, expectedCalls.length, 'Expected all Telegram requests to be sent')
})
