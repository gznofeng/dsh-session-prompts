/**
 * dsh-session-prompts — the loopback HTTP routes the browser uses to read and
 * write prompt state.
 *
 * Design constraints that shaped this file:
 *
 * - **Structural `req`/`res` only.** Nothing DSH-specific is imported, so the
 *   handlers can be driven by plain objects in tests and by the real web server
 *   in production. The module is pure Node built-ins.
 * - **Loopback only.** These routes are the write surface for the user's own
 *   machine; a request arriving over the network is refused before any handler
 *   logic (including body reading) runs.
 * - **Failures stay visible.** `store.loadState` deliberately rethrows I/O
 *   errors rather than pretending the file was empty. This layer must not undo
 *   that: an unreadable state file becomes a 500 with the underlying reason, not
 *   a 200 with `[]`. A silent empty list invites the browser to "fix" it with a
 *   save, which would overwrite data that was merely unreadable.
 * - **A corrupt state file refuses writes.** `loadState` flags an unparsable
 *   file instead of handing back an indistinguishable empty state (the bytes may
 *   still be hand-recoverable). `GET /state` therefore answers with the flag set
 *   so the UI can warn, and every write route answers 500 instead of overwriting
 *   the file. The read path never pretends the library is empty.
 * - **Recovery is an explicit re-read, never a refresh.** `/reload` calls
 *   `deps.reload()`, which re-reads the file from disk and replaces the host's
 *   snapshot. Without it, a file that was unreadable at activation could never be
 *   recovered from in this process, because every other route answers from that
 *   one snapshot. The settings page's Retry button drives this. A reload of a
 *   file that is STILL unparsable succeeds as a read and answers 200 with
 *   `corrupt: true` — the read genuinely worked — and every write stays refused,
 *   so this is not a back door around {@link assertWritable}.
 * - **Uniform response envelope.** All four routes answer with an object, never
 *   a bare array:
 *   `GET /state -> { prompts, ticks }` (`ticks` is the full
 *   `Record<sessionId, string[]>`, since that route's job is the whole picture),
 *   `POST /prompts -> { prompts }`, `POST /tick -> { sessionId, tickIds }`, and
 *   `POST /reload -> { prompts, ticks }` (the fresh state, in the same shape as
 *   `/state`, so the caller does not need a second round trip to render it).
 *   `/tick` deliberately answers with `tickIds` (the one session's array) rather
 *   than `ticks`: reusing the `ticks` key for a *string array* here would make one
 *   key carry two different types depending on the path, forcing the client to
 *   branch and to misread a per-session array as a whole map. A caller that wants
 *   the full map re-reads `/state`; `/tick` must not become a duplicate of it.
 *   Every response is an object, so there is room to add fields (`revision`,
 *   echoed errors) later without a breaking change.
 *   `GET /state` and `POST /reload` additionally carry `corrupt: true` — and ONLY
 *   then; an ordinary healthy answer must not grow the key, or every client-side
 *   check would have to distinguish `false` from absent.
 * - **An upsert is never a create for a named id.** `store.upsertPrompt` throws
 *   `UnknownPromptError` when a patch names an id that no longer exists; that
 *   becomes a **409 Conflict**, not a 500 (it is a version conflict with another
 *   writer, not a broken server) and not a silent create. Creating is the
 *   request shape that sends no id at all — and "no id" means the key is ABSENT,
 *   never a non-string value: `upsertPrompt` trims a non-string id to `''`,
 *   which would silently take the create path, so a present-but-non-string `id`
 *   is a 400 here.
 * - **Strict input validation on writes.** `setTick` treats only the literal
 *   `true` as "on", so a payload carrying the string `'true'` would silently
 *   *untick*. Non-boolean `on` is rejected here, before it reaches the store.
 */

import { deletePrompt, isCorrupt, setTick, upsertPrompt, UnknownPromptError } from './store.js'

/** The four exact paths, exported so callers and tests agree on one source. */
export const ROUTE_PATHS = {
  state: '/plugins/dsh-session-prompts/state',
  prompts: '/plugins/dsh-session-prompts/prompts',
  tick: '/plugins/dsh-session-prompts/tick',
  reload: '/plugins/dsh-session-prompts/reload',
}

/** Hard cap on an accepted request body. Anything larger is a client bug or abuse. */
const MAX_BODY_BYTES = 1024 * 1024

/**
 * Keys that must never be used as a `sessionId`.
 *
 * Measured against the current `store.js`: object spread builds `__proto__` as
 * an own enumerable key rather than polluting the prototype (only plain
 * assignment `obj[key] = v` would hit the setter), so there is no live
 * prototype hazard. The real harm is that `sanitizeState` drops the key on the
 * next read: the write appears to succeed and then silently fails to round-trip.
 * `constructor`/`prototype` persist outright as junk session ids. Since real
 * session ids are host-generated UUIDs, any of these three in a payload is
 * crafted or corrupt, and an explicit 400 beats a silent no-op.
 */
const FORBIDDEN_SESSION_IDS = new Set(['__proto__', 'constructor', 'prototype'])

/** @returns {boolean} true for a non-null, non-array object. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * An error carrying the HTTP status this layer should answer with.
 *
 * Everything else that escapes a handler is treated as an unexpected failure
 * (500) so that infrastructure problems are never dressed up as a successful
 * empty response.
 */
class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   */
  constructor(status, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

/**
 * Strip a scope/zone suffix (`fe80::1%eth0`) and lower-case the address.
 *
 * @param {unknown} remoteAddress
 * @returns {string | null} null when there is nothing usable to compare
 */
function normalizeAddress(remoteAddress) {
  if (typeof remoteAddress !== 'string') return null
  const address = remoteAddress.trim().toLowerCase()
  if (address === '') return null
  const zone = address.indexOf('%')
  return zone === -1 ? address : address.slice(0, zone)
}

/**
 * Parse a dotted-quad IPv4 address into its four octets.
 *
 * @param {string} address
 * @returns {number[] | null} null when the string is not a valid IPv4 literal
 */
function parseIPv4(address) {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const octets = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    octets.push(value)
  }
  return octets
}

/**
 * Parse the IPv4 embedded in a `::ffff:`-mapped IPv6 address.
 *
 * Node normally renders the mapped form as a dotted quad (`::ffff:127.0.0.1`),
 * but the hex spelling (`::ffff:7f00:1`) is also legal, so both are handled.
 *
 * @param {string} address the part after `::ffff:`
 * @returns {number[] | null} four octets, or null when it is not an IPv4-mapped literal
 */
function parseMappedIPv4(address) {
  if (address.includes('.')) return parseIPv4(address)
  // Node may render the embedded IPv4 as two hex groups: ::ffff:7f00:1
  const groups = address.split(':')
  if (groups.length !== 2) return null
  if (!groups.every(group => /^[0-9a-f]{1,4}$/.test(group))) return null
  const high = Number.parseInt(groups[0], 16)
  const low = Number.parseInt(groups[1], 16)
  return [high >> 8, high & 0xff, low >> 8, low & 0xff]
}

/**
 * Is this peer address on the loopback interface?
 *
 * Accepts `::1`, the whole `127.0.0.0/8` range, and IPv4-mapped forms of both
 * (`::ffff:127.0.0.1` and its hex spelling). Everything else — including a
 * missing address — is rejected: this is a write surface, so the safe default
 * is "not local".
 *
 * @param {unknown} remoteAddress
 * @returns {boolean}
 */
function isLoopback(remoteAddress) {
  const address = normalizeAddress(remoteAddress)
  if (address === null) return false
  if (address === '::1') return true

  const octets = address.startsWith('::ffff:')
    ? parseMappedIPv4(address.slice('::ffff:'.length))
    : parseIPv4(address)

  // `127.0.0.0/8` only. A v4-mapped IPv6 address keeps the same rule, which the
  // tests pin: ::ffff:10.0.0.1 is refused.
  return octets !== null && octets[0] === 127
}

/**
 * Consume and discard a body we are not going to parse.
 *
 * Without this the peer can keep a response-answered request body queued on the
 * socket. The optional call keeps the fake `req` objects used in tests working.
 *
 * @param {any} req
 */
function drain(req) {
  if (typeof req?.resume === 'function') req.resume()
}

/**
 * Write a JSON response once.
 *
 * @param {any} res
 * @param {number} status
 * @param {unknown} payload
 * @param {Record<string, string>} [headers]
 */
function sendJson(res, status, payload, headers) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers })
  res.end(JSON.stringify(payload))
}

/**
 * @param {any} res
 * @param {number} status
 * @param {string} message
 * @param {Record<string, string>} [headers]
 */
function sendError(res, status, message, headers) {
  sendJson(res, status, { error: message }, headers)
}

/**
 * Read the request body as text, refusing anything above {@link MAX_BODY_BYTES}.
 *
 * The limit is enforced while accumulating rather than from `Content-Length`,
 * because that header is attacker-controlled and may be absent entirely.
 *
 * @param {any} req
 * @returns {Promise<string>} the raw UTF-8 body
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false

    const fail = message => {
      if (settled) return
      settled = true
      reject(new HttpError(400, message))
    }

    req.on('data', chunk => {
      if (settled) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_BODY_BYTES) {
        fail('请求体超过 1 MiB 上限')
        return
      }
      chunks.push(buffer)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', () => fail('请求体读取失败'))
  })
}

/**
 * Parse a JSON request body.
 *
 * An empty body is an error here on purpose: both POST routes require a payload,
 * and `JSON.parse('')` would otherwise produce a confusing syntax message.
 *
 * @param {any} req
 * @returns {Promise<unknown>}
 */
async function readJsonBody(req) {
  const text = await readBody(req)
  if (text.trim() === '') throw new HttpError(400, '请求体不能为空')
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, '请求体不是合法的 JSON')
  }
}

/**
 * Reject a `State` that does not have the shape the routes serialize.
 *
 * Deliberately strict: coercing a broken state into `{ prompts: [], ticks: {} }`
 * would make a dependency failure look like "the user has no prompts", which is
 * the exact confusion this module's header warns about.
 *
 * @param {unknown} state
 * @returns {{ prompts: unknown[], ticks: Record<string, unknown> }}
 */
function assertStateShape(state) {
  if (!isRecord(state)) throw new TypeError('deps.state() 未返回状态对象')
  if (!Array.isArray(state.prompts)) throw new TypeError('state.prompts 不是数组')
  if (!isRecord(state.ticks)) throw new TypeError('state.ticks 不是对象')
  return state
}

/**
 * Turn anything thrown into a short, human-readable reason.
 *
 * @param {unknown} error
 * @returns {string}
 */
function describeFailure(error) {
  if (error instanceof Error) {
    const code = typeof error.code === 'string' && error.code !== '' ? `${error.code}: ` : ''
    const message = typeof error.message === 'string' && error.message !== '' ? error.message : '未知错误'
    return message.startsWith(code) ? message : `${code}${message}`
  }
  if (typeof error === 'string' && error !== '') return error
  return '未知错误'
}

/**
 * Validate a `/tick` payload.
 *
 * @param {unknown} body
 * @returns {{ sessionId: string, promptId: string, on: boolean }}
 */
function validateTickPayload(body) {
  if (!isRecord(body)) throw new HttpError(400, '请求体必须是 JSON 对象')

  const { sessionId, promptId, on } = body

  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new HttpError(400, 'sessionId 必须是非空字符串')
  }
  if (FORBIDDEN_SESSION_IDS.has(sessionId)) {
    throw new HttpError(400, `sessionId 不能是保留键 ${sessionId}`)
  }
  if (typeof promptId !== 'string' || promptId.trim() === '') {
    throw new HttpError(400, 'promptId 必须是非空字符串')
  }
  // Strict boolean: `setTick` tests `on === true`, so `'true'` or `1` would be a
  // silent untick — worse to debug than a 400.
  if (typeof on !== 'boolean') throw new HttpError(400, 'on 必须是布尔值 true 或 false')

  return { sessionId, promptId, on }
}

/**
 * Validate a `/prompts` payload.
 *
 * @param {unknown} body
 * @returns {{ op: 'upsert', prompt: Record<string, unknown> } | { op: 'delete', id: string }}
 */
function validatePromptsPayload(body) {
  if (!isRecord(body)) throw new HttpError(400, '请求体必须是 JSON 对象')

  if (body.op === 'upsert') {
    // Per-field types are validated by `upsertPrompt`, which ignores bad fields
    // instead of coercing them; only the envelope is checked here — with one
    // exception. `id` is not an ordinary field: `upsertPrompt` derives create-vs-
    // update from it and treats a non-string as "no id", so `{ id: 7 }` would be
    // a silent CREATE from a malformed request. Real ids are host-generated UUID
    // strings, so nothing legitimate is lost by refusing the shape outright.
    if (!isRecord(body.prompt)) throw new HttpError(400, 'upsert 需要 prompt 对象')
    if (Object.hasOwn(body.prompt, 'id') && typeof body.prompt.id !== 'string') {
      throw new HttpError(400, 'prompt.id 必须是字符串；新建请完全省略 id')
    }
    return { op: 'upsert', prompt: body.prompt }
  }
  if (body.op === 'delete') {
    if (typeof body.id !== 'string' || body.id.trim() === '') {
      throw new HttpError(400, 'delete 需要非空字符串 id')
    }
    return { op: 'delete', id: body.id }
  }
  throw new HttpError(400, `op 必须是 "upsert" 或 "delete"，收到 ${String(body.op)}`)
}

/**
 * Read the current state, converting infrastructure failures into a 500.
 *
 * Both the call and the shape check are covered: a throwing `state()` and a
 * `state()` that returns nonsense are the same class of problem for the caller
 * (the layer underneath is broken), and neither may degrade to an empty list.
 *
 * The returned object is the state itself, so the corruption flag set by
 * `store.loadState` rides along to the route that needs it.
 *
 * @param {{ state: () => any }} deps
 * @returns {{ prompts: unknown[], ticks: Record<string, unknown>, corrupt?: true }}
 */
function readState(deps) {
  try {
    return assertStateShape(deps.state())
  } catch (error) {
    throw new HttpError(500, `读取提示词状态失败：${describeFailure(error)}`)
  }
}

/**
 * Refuse a write while the state file is unparsable.
 *
 * The bytes on disk may still be recovered by hand (they are untouched, because
 * `loadState` never rewrites what it could not read). Persisting anything now
 * would replace them with the empty state this process is holding, destroying
 * the only copy of the user's prompts and ticks. A 500 with a readable reason is
 * the honest answer — the same class as "the file is unreadable" — and it is
 * what the settings page renders as an error instead of its empty state.
 *
 * @param {any} state the state read through {@link readState}
 * @throws {HttpError} 500 when that state is flagged corrupt
 */
function assertWritable(state) {
  if (!isCorrupt(state)) return
  throw new HttpError(
    500,
    '状态文件无法解析，已拒绝写入以免覆盖仍可手工恢复的数据；请先修好或移走该文件再重试',
  )
}

/**
 * Apply one immutable transform through `deps.mutate` and read the committed
 * result back.
 *
 * Reading back through `deps.state()` instead of trusting the transform's return
 * value keeps this layer honest: whatever the persistence layer normalized or
 * sanitized is what the browser is told about.
 *
 * A corrupt state is refused before the transform ever runs (see
 * {@link assertWritable}), so no write route can paper over an unparsable file.
 * `UnknownPromptError` from `store.upsertPrompt` is a conflict, not a server
 * failure: it propagates as a 409 with the id in the message, and — because the
 * store throws before touching the state — nothing was written.
 *
 * @param {{ state: () => any, mutate: (fn: (state: any) => any) => Promise<void> }} deps
 * @param {(state: any) => any} transform
 * @returns {Promise<any>} the state after the write
 */
async function applyMutation(deps, transform) {
  assertWritable(readState(deps))
  try {
    await deps.mutate(transform)
  } catch (error) {
    if (error instanceof UnknownPromptError) throw new HttpError(409, error.message)
    throw new HttpError(500, `写入提示词状态失败：${describeFailure(error)}`)
  }
  return readState(deps)
}

/**
 * The tick ids a session currently has, as a copy.
 *
 * `Object.hasOwn` rather than a truthiness test so a session with `[]` reads as
 * "explicitly ticked nothing" instead of falling through to `[]` by accident —
 * same distinction `render.js` relies on.
 *
 * @param {any} state
 * @param {string} sessionId
 * @returns {string[]}
 */
function tickIdsFor(state, sessionId) {
  if (!Object.hasOwn(state.ticks, sessionId)) return []
  const ids = state.ticks[sessionId]
  return Array.isArray(ids) ? ids.slice() : []
}

/**
 * Copy the ticks map so a response can never alias live state arrays.
 *
 * @param {Record<string, unknown>} ticks
 * @returns {Record<string, string[]>}
 */
function copyTicks(ticks) {
  const copy = {}
  for (const [sessionId, ids] of Object.entries(ticks)) {
    Object.defineProperty(copy, sessionId, {
      value: Array.isArray(ids) ? ids.slice() : [],
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return copy
}

/**
 * The `{ prompts, ticks, corrupt? }` envelope `/state` and `/reload` both answer.
 *
 * One helper so the two read-shaped routes cannot drift: `corrupt` is added ONLY
 * when true, a healthy answer keeps exactly the two documented keys, and no
 * client has to tell `false` from absent.
 *
 * @param {any} state the state read through {@link readState}
 * @returns {{ prompts: unknown[], ticks: Record<string, string[]>, corrupt?: true }}
 */
function stateBody(state) {
  const body = { prompts: state.prompts.slice(), ticks: copyTicks(state.ticks) }
  if (isCorrupt(state)) body.corrupt = true
  return body
}

/**
 * Build the routes.
 *
 * @param {{
 *   state: () => any,
 *   mutate: (fn: (state: any) => any) => Promise<void>,
 *   reload: () => Promise<void>,
 * }} deps
 *   `state()` returns the current State snapshot; `mutate(fn)` receives the
 *   current state, applies `fn`'s return value and persists it; `reload()`
 *   re-reads the state file from disk and replaces that snapshot. Where the
 *   persistence happens is deliberately not this module's business.
 * @returns {{ kind: 'exact', path: string, handler: (req: any, res: any) => Promise<void> }[]}
 */
export function createRoutes(deps) {
  if (typeof deps?.state !== 'function' || typeof deps?.mutate !== 'function') {
    throw new TypeError('createRoutes 需要 { state, mutate } 两个函数')
  }
  if (typeof deps?.reload !== 'function') {
    // Required, not optional: without it `/reload` could only re-read memory and
    // the route would promise a recovery it cannot deliver.
    throw new TypeError('createRoutes 需要 reload 函数')
  }

  /**
   * Wrap one route body with the guards every route shares.
   *
   * Order matters: loopback, then method, then body. A remote caller learns
   * nothing about a route's payload contract.
   *
   * @param {'GET' | 'POST'} method
   * @param {(body: unknown) => Promise<{ status: number, body: unknown }>} handle
   */
  function makeHandler(method, handle) {
    return async function handler(req, res) {
      if (!isLoopback(req?.socket?.remoteAddress)) {
        drain(req)
        sendError(res, 403, '只接受来自本机回环地址的请求')
        return
      }

      if (req.method !== method) {
        drain(req)
        sendError(res, 405, `该路径只支持 ${method}`, { allow: method })
        return
      }

      try {
        const body = method === 'POST' ? await readJsonBody(req) : undefined
        const result = await handle(body)
        sendJson(res, result.status, result.body)
      } catch (error) {
        if (error instanceof HttpError) {
          sendError(res, error.status, error.message)
          return
        }
        sendError(res, 500, `处理请求失败：${describeFailure(error)}`)
      }
    }
  }

  return [
    {
      kind: 'exact',
      path: ROUTE_PATHS.state,
      handler: makeHandler('GET', async () => {
        return { status: 200, body: stateBody(readState(deps)) }
      }),
    },
    {
      kind: 'exact',
      path: ROUTE_PATHS.reload,
      handler: makeHandler('POST', async () => {
        // `deps.reload()` is the ONLY thing here that touches disk, and it is
        // what makes recovery possible without restarting the process: the
        // snapshot every other route answers from is replaced by the file's
        // current content. A reload that still cannot read the file is a 500
        // with the reason — that is the honest answer, exactly as it is for
        // `GET /state` at startup. A merely unparsable file is NOT a reload
        // failure: the read succeeded and the flag rides along, while writes
        // stay refused.
        try {
          await deps.reload()
        } catch (error) {
          // The message deliberately speaks about reading only. Saying "still
          // corrupt" here would be wrong for the unparsable case, which does not
          // land in this branch at all.
          throw new HttpError(500, `重新读取提示词状态失败：${describeFailure(error)}`)
        }
        return { status: 200, body: stateBody(readState(deps)) }
      }),
    },
    {
      kind: 'exact',
      path: ROUTE_PATHS.prompts,
      handler: makeHandler('POST', async body => {
        const action = validatePromptsPayload(body)
        const state = await applyMutation(deps, current =>
          action.op === 'upsert'
            ? upsertPrompt(current, action.prompt)
            : deletePrompt(current, action.id))
        return { status: 200, body: { prompts: state.prompts.slice() } }
      }),
    },
    {
      kind: 'exact',
      path: ROUTE_PATHS.tick,
      handler: makeHandler('POST', async body => {
        const { sessionId, promptId, on } = validateTickPayload(body)
        const state = await applyMutation(deps, current => setTick(current, sessionId, promptId, on))
        // `tickIds`, not `ticks`: see the envelope note in the module header.
        // Echoing the sessionId back lets a client correlate a response with the
        // request when several sessions' toggles are in flight at once.
        return { status: 200, body: { sessionId, tickIds: tickIdsFor(state, sessionId) } }
      }),
    },
  ]
}
