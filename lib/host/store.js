/**
 * dsh-session-prompts — session-scoped prompt state.
 *
 * Pure state module: no DSH API calls, no config schema, Node built-ins only.
 *
 * State shape:
 *   {
 *     version: number,
 *     prompts: [{ id, title, text, enabled, pinned, order }],
 *     ticks: Record<sessionId, promptId[]>,
 *   }
 *
 * Every mutator is functional: it takes a State and returns a NEW State, never
 * mutating the argument. Callers (route handlers) rely on that to compute the
 * next state from the current one without holding a mutable reference that a
 * concurrent request could observe half-updated.
 *
 * `ticks` deliberately outlives `prompts`: deleting a prompt removes the prompt
 * but leaves the tick records alone, so `countTicks` stays meaningful for audit.
 * A stale tick can never come back to life, because a prompt is never re-created
 * under an existing id: {@link upsertPrompt} rejects an id it does not know.
 *
 * **An unparsable file is not an empty file.** {@link loadState} flags the state
 * it returns instead of handing back `emptyState()`, so the layers above can
 * refuse to write over data that is still hand-recoverable.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** On-disk schema version. Bump only alongside a migration in `sanitizeState`. */
const CURRENT_VERSION = 1

/** A prompt injected as a system-prompt section while ticked. The default. */
export const PROMPT_KIND_SYSTEM = 'system'

/** A snippet the user clicks to append into the composer. Never injected. */
export const PROMPT_KIND_QUICK = 'quick'

/**
 * @typedef {object} Prompt
 * @property {string} id
 * @property {'system' | 'quick'} kind
 * @property {string} title
 * @property {string} text
 * @property {boolean} enabled
 * @property {boolean} pinned — render this prompt's row inline in the strip
 *   instead of inside its group's popup; applies to both kinds
 * @property {number} order
 *
 * @typedef {object} State
 * @property {number} version
 * @property {Prompt[]} prompts
 * @property {Record<string, string[]>} ticks
 * @property {true} [corrupt] set only by `loadState` on an unparsable file;
 *   never part of the on-disk schema and never treated as prompt data
 */

/**
 * The property {@link loadState} uses to flag an unparsable file.
 *
 * A plain own property rather than a Symbol so it survives `structuredClone`
 * and is trivially visible when a state is inspected or logged. It cannot leak
 * onto disk or be mistaken for prompt data: {@link sanitizeState} rebuilds
 * `{ version, prompts, ticks }` from scratch and drops every other key, and
 * {@link saveState} runs its input through `sanitizeState` before serializing.
 */
const CORRUPT_KEY = 'corrupt'

/** @returns {boolean} true for a non-null, non-array object. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Did this state come from a file that could not be parsed?
 *
 * Callers use it to refuse writes: the bytes on disk may still be recoverable by
 * hand, so overwriting them would destroy the only copy of the user's data.
 *
 * @param {unknown} state
 * @returns {boolean}
 */
export function isCorrupt(state) {
  return isRecord(state) && state[CORRUPT_KEY] === true
}

/** @returns {boolean} true for a non-empty string. */
function isNonEmptyString(value) {
  return typeof value === 'string' && value !== ''
}

/**
 * Normalize one raw prompt record.
 *
 * Returns `null` when the record cannot be identified (not an object, or no
 * usable `id`), which is how malformed entries get dropped.
 *
 * Invariant enforced here and therefore at every entry point: **pinned implies
 * enabled**. A record claiming `pinned: true, enabled: false` is a state the
 * product forbids, so persistence never admits it — `pinned` is demoted.
 *
 * A prompt is one of two kinds:
 * - `'system'` (the default, and what every record written before `kind`
 *   existed becomes): injected as a system-prompt section while ticked.
 * - `'quick'`: a snippet the user clicks to append into the composer. It is
 *   never injected and never ticked, so it carries neither `enabled` nor
 *   `pinned` semantics — `pinned` is always false for it.
 *
 * An unknown or missing `kind` falls back to `'system'`, which keeps existing
 * state files working without a migration.
 *
 * @param {unknown} raw
 * @param {number} order used when the record has no usable `order`
 * @returns {Prompt | null}
 */
function normalizePrompt(raw, order) {
  if (!isRecord(raw)) return null

  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (id === '') return null

  const kind = raw.kind === 'quick' ? 'quick' : PROMPT_KIND_SYSTEM
  const enabled = raw.enabled === true
  // Both kinds can be pinned: a pinned row is the always-visible entry point the
  // user reaches for without opening a group, and a quick prompt is exactly the
  // thing clicked often enough to earn one. What differs is what a click does.
  const pinned = raw.pinned === true && enabled

  return {
    id,
    kind,
    title: typeof raw.title === 'string' ? raw.title : '',
    text: typeof raw.text === 'string' ? raw.text : '',
    enabled,
    pinned,
    order: Number.isFinite(raw.order) ? raw.order : order,
  }
}

/**
 * Coerce arbitrary parsed JSON into a well-formed State.
 *
 * Tolerant by contract: a non-object input, a non-array `prompts`, or a
 * non-object `ticks` yields empty collections instead of throwing, because a
 * corrupt file on disk must never take the host down.
 *
 * @param {unknown} raw
 * @returns {State}
 */
export function sanitizeState(raw) {
  const source = isRecord(raw) ? raw : {}

  const prompts = []
  const seen = new Set()
  for (const entry of Array.isArray(source.prompts) ? source.prompts : []) {
    const prompt = normalizePrompt(entry, prompts.length)
    if (prompt === null) continue
    if (seen.has(prompt.id)) continue // first record with an id wins
    seen.add(prompt.id)
    prompts.push(prompt)
  }

  const ticks = {}
  for (const [sessionId, value] of Object.entries(isRecord(source.ticks) ? source.ticks : {})) {
    if (sessionId === '' || !Array.isArray(value)) continue
    // `__proto__` 不是合法的 sessionId：手工编辑过的 JSON 里出现它，只可能是损坏或被构造的输入。
    // 直接赋值会触发原型 setter（键丢失 + ticks 原型被换成那个数组，让 countTicks 多算），
    // 而原样保留又会把它当成一个真实会话（同样多算）。丢掉它，与「丢弃没有合法 id 的条目」一致。
    if (sessionId === '__proto__') continue
    const ids = []
    for (const id of value) {
      if (isNonEmptyString(id) && !ids.includes(id)) ids.push(id)
    }
    // 用 defineProperty 而非赋值，作为纵深防御：任何特殊键名都不会走到原型 setter。
    Object.defineProperty(ticks, sessionId, { value: ids, enumerable: true, writable: true, configurable: true })
  }

  const version = Number.isInteger(source.version) && source.version > 0 ? source.version : CURRENT_VERSION

  return { version, prompts, ticks }
}

/** @returns {State} a fresh, empty state. */
export function emptyState() {
  return { version: CURRENT_VERSION, prompts: [], ticks: {} }
}

/**
 * Read a State from disk.
 *
 * Three outcomes, deliberately distinct:
 *
 * - **missing file** -> `emptyState()`. There is genuinely nothing to lose, so a
 *   later save is harmless.
 * - **unparsable JSON** -> `emptyState()` **flagged** with {@link isCorrupt}.
 *   The file itself is left untouched on purpose: the user's data may still be
 *   recoverable by hand, so a read must never truncate it. The flag is what
 *   stops the layers above from answering "you have no prompts" and from
 *   overwriting those bytes — see `isCorrupt` and `routes.js`.
 * - **any other I/O failure** (permissions, path is a directory) is rethrown:
 *   the caller must not proceed to save, or the unreadable file would be
 *   replaced.
 *
 * A leading UTF-8 BOM is stripped before parsing. Files re-saved by Windows
 * Notepad carry one, and `JSON.parse` rejects it; without this a perfectly
 * readable file would be misreported as corrupt.
 *
 * @param {string} filePath
 * @returns {Promise<State>} possibly flagged by {@link isCorrupt}
 */
export async function loadState(filePath) {
  let text
  try {
    text = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return emptyState()
    throw error
  }

  let parsed
  try {
    parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    return { ...emptyState(), [CORRUPT_KEY]: true }
  }

  return sanitizeState(parsed)
}

/**
 * Persist a State atomically.
 *
 * The payload is sanitized first, so the pinned⇒enabled invariant holds on
 * disk even if a caller hands in a sloppy state. Writes go to a sibling temp
 * file and are then renamed over the target: a crash mid-write leaves the real
 * file intact rather than truncated.
 *
 * @param {string} filePath
 * @param {State} state
 * @returns {Promise<void>}
 */
export async function saveState(filePath, state) {
  const payload = `${JSON.stringify(sanitizeState(state), null, 2)}\n`
  const tmpPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(tmpPath, payload, 'utf8')
    await fs.rename(tmpPath, filePath)
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * A `patch` named an `id` that is not in the state.
 *
 * Deliberately an error rather than a create. Creating on an unknown id would
 * resurrect a prompt another tab (or another app instance) had just deleted, and
 * because `deletePrompt` keeps the tick records, that resurrected prompt would
 * be **immediately re-injected** into every session that had it ticked — with no
 * user-visible signal at all. A create is expressed by sending **no** id, which
 * is the only request shape that mints a fresh `randomUUID()`.
 *
 * Callers distinguish the two cases by catching this, so the create path stays
 * exactly as it was.
 */
export class UnknownPromptError extends Error {
  /** @param {string} id the id the patch named */
  constructor(id) {
    super(`提示词 ${id} 不存在（可能是另一个页面刚删掉了它）`)
    this.name = 'UnknownPromptError'
    /** The offending id, so a route can echo it back. */
    this.id = id
  }
}

/**
 * Insert or update a prompt.
 *
 * Three request shapes, three outcomes:
 *
 * - **no usable `id`** -> a new prompt is created (`randomUUID()`, appended
 *   last). This is the only way to create one.
 * - **an `id` that exists** -> updates only the fields the patch carries,
 *   leaving the rest as-is.
 * - **an `id` that does not exist** -> throws {@link UnknownPromptError}, and
 *   the state is not touched. An upsert is never a create for a named id.
 *
 * A *present but non-string* `id` counts as "no usable id" here and therefore
 * takes the create path; that is why `routes.js` rejects such a payload with a
 * 400 before it ever reaches this function. Real ids are UUID strings, so a
 * malformed request creating a prompt silently is a surprise, not a feature.
 *
 * Fields of the wrong type are ignored rather than coerced, so a bad request
 * cannot corrupt the record.
 *
 * @param {State} state
 * @param {object} patch
 * @returns {State}
 * @throws {UnknownPromptError} when `patch.id` names an unknown prompt
 */
export function upsertPrompt(state, patch) {
  const base = sanitizeState(state)
  if (!isRecord(patch)) return base

  const patchId = typeof patch.id === 'string' ? patch.id.trim() : ''
  const index = patchId === '' ? -1 : base.prompts.findIndex(prompt => prompt.id === patchId)

  // Checked before any mutation of `base`: a rejected upsert leaves the state
  // exactly as it arrived.
  if (patchId !== '' && index === -1) throw new UnknownPromptError(patchId)

  /** Apply only the fields the patch actually carries, with valid types. */
  const applyPatch = target => {
    const next = { ...target }
    if (typeof patch.title === 'string') next.title = patch.title
    if (typeof patch.text === 'string') next.text = patch.text
    // Only the two known kinds are accepted; anything else leaves the record's
    // current kind alone rather than guessing.
    if (patch.kind === PROMPT_KIND_SYSTEM || patch.kind === PROMPT_KIND_QUICK) next.kind = patch.kind
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
    if (typeof patch.pinned === 'boolean') next.pinned = patch.pinned
    if (Number.isFinite(patch.order)) next.order = patch.order
    return next
  }

  if (index === -1) {
    const created = normalizePrompt({ ...applyPatch({}), id: randomUUID() }, base.prompts.length)
    if (created === null) return base
    return { ...base, prompts: [...base.prompts, created] }
  }

  // Re-normalizing the merged record is what demotes `pinned` when a patch
  // turns `enabled` off.
  const updated = normalizePrompt(applyPatch(base.prompts[index]), base.prompts[index].order)
  if (updated === null) return base

  const prompts = base.prompts.slice()
  prompts[index] = updated
  return { ...base, prompts }
}

/**
 * Remove a prompt by id.
 *
 * `ticks` is intentionally left untouched — see the module comment.
 *
 * @param {State} state
 * @param {string} id
 * @returns {State}
 */
export function deletePrompt(state, id) {
  const base = sanitizeState(state)
  if (typeof id !== 'string' || id === '') return base
  return { ...base, prompts: base.prompts.filter(prompt => prompt.id !== id) }
}

/**
 * Tick or untick a prompt for one session. Idempotent: ticking twice keeps a
 * single entry.
 *
 * The session's array is kept — as `[]` — when the last tick is turned off,
 * rather than deleting the key; an empty array records "this session exists and
 * currently ticks nothing" for later `countTicks` scans.
 *
 * @param {State} state
 * @param {string} sessionId
 * @param {string} promptId
 * @param {boolean} on
 * @returns {State}
 */
export function setTick(state, sessionId, promptId, on) {
  const base = sanitizeState(state)
  if (!isNonEmptyString(sessionId) || !isNonEmptyString(promptId)) return base

  const current = base.ticks[sessionId]
  const ids = Array.isArray(current) ? current : []

  let nextIds
  if (on === true) {
    nextIds = ids.includes(promptId) ? ids.slice() : [...ids, promptId]
  } else {
    if (current === undefined) return { ...base, ticks: { ...base.ticks } }
    nextIds = ids.filter(id => id !== promptId)
  }

  return { ...base, ticks: { ...base.ticks, [sessionId]: nextIds } }
}

/**
 * How many sessions currently tick `promptId`.
 *
 * Used to warn before disabling a prompt that live sessions still use.
 *
 * @param {State} state
 * @param {string} promptId
 * @returns {number}
 */
export function countTicks(state, promptId) {
  if (!isNonEmptyString(promptId)) return 0
  const base = sanitizeState(state)
  let count = 0
  for (const ids of Object.values(base.ticks)) {
    if (ids.includes(promptId)) count += 1
  }
  return count
}
