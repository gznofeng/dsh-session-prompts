/**
 * dsh-session-prompts — effective tick resolution and prompt-body rendering.
 *
 * Pure module: no filesystem, no network, no DSH API, and no mutation of the
 * `State` it is given. The caller injects `parentOf` precisely so this file
 * needs no knowledge of how sessions relate to each other: Task 5 supplies a
 * closure over `ctx.session`, tests supply a literal map.
 *
 * Two questions are answered here, and only here:
 *   1. which prompt ids does a session actually get? (`resolveEffectiveTicks`)
 *   2. what single system-prompt block do those ids produce? (`renderPromptText`)
 */

/**
 * @typedef {object} Prompt
 * @property {string} id
 * @property {string} title
 * @property {string} text
 * @property {boolean} enabled
 * @property {boolean} pinned
 * @property {number} order
 *
 * @typedef {object} State
 * @property {number} version
 * @property {Prompt[]} prompts
 * @property {Record<string, string[]>} ticks
 */

/** @returns {boolean} true for a non-null, non-array object. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @returns {boolean} true for a non-empty string. */
function isNonEmptyString(value) {
  return typeof value === 'string' && value !== ''
}

/**
 * Resolve the prompt ids a session effectively ticks.
 *
 * A session's **own** entry in `state.ticks` wins, even when it is the empty
 * array: `[]` means "this session was explicitly configured to tick nothing",
 * so it must shadow the parent rather than fall through to it. That is why the
 * presence test is `Object.hasOwn`, not a truthiness check and not
 * `state.ticks[id] !== undefined` — the latter two would treat `[]` as absent
 * and silently resurrect a parent's prompts.
 *
 * With no own entry, the walk climbs `parentOf` and returns the first ancestor
 * that has one. A `parentOf` chain that loops (corrupt input) is cut short by
 * the `visited` set so this always returns instead of hanging.
 *
 * The returned array is a copy: callers may sort or splice it freely without
 * corrupting the state they were handed.
 *
 * @param {State} state
 * @param {string} sessionId
 * @param {(id: string) => string | undefined} parentOf
 * @returns {string[]} the effective prompt ids, `[]` when nothing resolves
 */
export function resolveEffectiveTicks(state, sessionId, parentOf) {
  if (!isRecord(state) || !isNonEmptyString(sessionId)) return []

  const ticks = isRecord(state.ticks) ? state.ticks : {}
  const visited = new Set()

  let id = sessionId
  while (isNonEmptyString(id)) {
    // Corrupt `parentSession` data can form a cycle; stop rather than spin.
    if (visited.has(id)) break
    visited.add(id)

    if (Object.hasOwn(ticks, id)) {
      const ids = ticks[id]
      // A malformed value (not an array) has no meaning as a tick set, so treat
      // it as "nothing resolved" rather than inheriting past a real entry.
      return Array.isArray(ids) ? ids.slice() : []
    }

    const parent = typeof parentOf === 'function' ? parentOf(id) : undefined
    if (!isNonEmptyString(parent)) break
    id = parent
  }

  return []
}

/**
 * Join the selected prompts' bodies into one system-prompt block.
 *
 * Ordering follows the `ids` argument, not `prompt.order`: the caller decides
 * the reading order (UI drag order, pinned-first, whatever), and a renderer
 * that re-sorts would make that decision behind its back.
 *
 * A paragraph is skipped — contributing no text and no separator — when the id
 * is unknown (deleted prompt), when `enabled !== true` (the "生效中" switch is a
 * real kill switch), or when `text.trim()` is empty. Joining survives only, so
 * there are never stray `'\n\n'` runs or leading/trailing imports.
 *
 * Text passes through **literally**. This module performs no interpolation:
 * `{{name}}` reaches the model exactly as authored. (Task 5 additionally sets
 * `interpolate: false` upstream, but that is belt-and-braces — nothing here
 * would touch a brace either way.)
 *
 * @param {State} state
 * @param {string[]} ids
 * @returns {string} the block, `''` when nothing survives
 */
export function renderPromptText(state, ids) {
  if (!isRecord(state) || !Array.isArray(ids)) return ''

  const prompts = Array.isArray(state.prompts) ? state.prompts : []

  const byId = new Map()
  for (const prompt of prompts) {
    if (!isRecord(prompt)) continue
    const id = typeof prompt.id === 'string' ? prompt.id : ''
    // First record wins, matching how `sanitizeState` dedupes persisted state.
    if (id === '' || byId.has(id)) continue
    byId.set(id, prompt)
  }

  const paragraphs = []
  for (const id of ids) {
    if (typeof id !== 'string') continue
    const prompt = byId.get(id)
    if (prompt === undefined) continue
    // A quick prompt is a snippet the user pastes into the composer, never a
    // system section. A stale tick left over from before a kind switch must not
    // smuggle it into the prompt.
    if (prompt.kind === 'quick') continue
    if (prompt.enabled !== true) continue
    if (typeof prompt.text !== 'string' || prompt.text.trim() === '') continue
    paragraphs.push(prompt.text)
  }

  return paragraphs.join('\n\n')
}
