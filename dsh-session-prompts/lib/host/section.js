/**
 * dsh-session-prompts — per-agent system-prompt section registration.
 *
 * No DSH import and no I/O: `register`, `getState` and `parentOf` are injected,
 * so the whole module is drivable from a plain object in tests. The host side
 * (index.js) supplies `agent.ctx.systemPrompt.section`, the in-memory state
 * snapshot, and the `parentSession` walk.
 *
 * Two invariants live here because `index.js` cannot enforce them:
 *
 * 1. **`interpolate: false` on every registration.** The prompt renderer throws
 *    on unknown or malformed `{{…}}` in a section, and prompt text is
 *    user-authored — a stray brace is ordinary. One throwing section would fail
 *    *every request in that session*, so the text is handed over literally.
 *
 * 2. **One registration per agent, ever.** `SessionStartSource` includes
 *    `'clear'` and `'compact'`, so `agent/created` can fire more than once for
 *    the same agent, and registering the same section name twice in one scope
 *    throws. The map below is the idempotency guard.
 *
 * `text` is a function, not a string: the registry evaluates it per assembly,
 * so a tick change on the browser side takes effect from the next step with no
 * notification channel, cache invalidation, or re-registration.
 */

import { renderPromptText, resolveEffectiveTicks } from './render.js'

/**
 * @typedef {object} PromptSection
 * @property {string} name
 * @property {number} order
 * @property {string | ((context: unknown) => string)} text
 * @property {boolean} [interpolate]
 * @property {boolean} [complete]
 */

/**
 * Build the per-agent section manager.
 *
 * @param {object} options
 * @param {(agentId: string, section: PromptSection) => (() => void) | void} options.register
 *   Registers `section` in that agent's scope and returns its disposer.
 * @param {() => any} options.getState returns the current state snapshot
 * @param {(id: string) => string | undefined} options.parentOf the durable
 *   `parentSession` of a session, or `undefined` at the root
 * @param {number} options.order placement among the assembled sections
 * @returns {{
 *   ensure: (agentId: string, sectionName: string) => void,
 *   release: (agentId: string) => void,
 *   disposeAll: () => void,
 * }}
 */
export function createAgentSections({ register, getState, parentOf, order }) {
  // Validate up front rather than deferring to the first `agent/created`: a
  // missing dependency would otherwise surface as a half-wired plugin that
  // silently injects nothing.
  if (typeof register !== 'function') throw new TypeError('createAgentSections 需要 register 函数')
  if (typeof getState !== 'function') throw new TypeError('createAgentSections 需要 getState 函数')
  if (typeof parentOf !== 'function') throw new TypeError('createAgentSections 需要 parentOf 函数')
  if (!Number.isFinite(order)) throw new TypeError('createAgentSections 需要有限数字 order')

  /** @type {Map<string, (() => void) | undefined>} agentId -> disposer */
  const registrations = new Map()

  /**
   * The section body for one agent, recomputed on every call.
   *
   * `resolveEffectiveTicks` and `renderPromptText` each get a fresh
   * `getState()`: the state object can be swapped between two calls only in
   * theory (it is read once per mutation), but reading it twice costs nothing
   * and keeps this function free of a captured, potentially stale snapshot.
   *
   * **Never throws.** This runs during prompt assembly, so a throw here fails
   * *every request in that session* — the exact outcome `interpolate: false`
   * exists to prevent, arriving by another route. The pure render functions and
   * a plain `getState()` read cannot throw; the one true hazard is the injected
   * `parentOf`, which performs a live service lookup whose lifetime this module
   * does not own. Degrading to "this session gets no prompt text" is strictly
   * better than "this session cannot talk to the model at all".
   *
   * @param {string} agentId
   * @returns {string} the block, `''` when nothing resolves (section vanishes)
   */
  function textFor(agentId) {
    try {
      const ids = resolveEffectiveTicks(getState(), agentId, parentOf)
      return renderPromptText(getState(), ids)
    } catch {
      return ''
    }
  }

  /**
   * Register the section for one agent, at most once.
   *
   * Idempotent by design: a second call for a live agent is a no-op, not a
   * second registration (which would throw and fail the `agent/created`
   * dispatch, taking creation down with it).
   *
   * A throwing `register` leaves the map untouched and propagates: the caller
   * owns the decision of whether that fails creation. Recording a registration
   * that never happened would make every later `ensure` a silent no-op and lose
   * the section for that agent's whole lifetime.
   *
   * @param {string} agentId
   * @param {string} sectionName
   */
  function ensure(agentId, sectionName) {
    if (typeof agentId !== 'string' || agentId === '') return
    if (registrations.has(agentId)) return

    const disposer = register(agentId, {
      name: sectionName,
      order,
      // See the module header: a brace in user text must never be interpolated.
      interpolate: false,
      // A function so each assembly reflects the current ticks.
      text: () => textFor(agentId),
    })

    // A registration whose disposer is missing still happened; remembering `undefined`
    // keeps `ensure` idempotent, and `release` simply has nothing to call.
    registrations.set(agentId, typeof disposer === 'function' ? disposer : undefined)
  }

  /**
   * Drop one agent's registration so a later `ensure` can register again.
   *
   * @param {string} agentId
   */
  function release(agentId) {
    const disposer = registrations.get(agentId)
    // Delete before disposing: a throwing disposer must not leave an entry that
    // blocks the next `ensure` from re-registering.
    registrations.delete(agentId)
    if (typeof disposer === 'function') disposer()
  }

  /**
   * Drop every registration. Used on plugin unload.
   *
   * Every entry is attempted even if an earlier disposer throws: stopping at the
   * first failure would leak the remaining agents' sections for the rest of the
   * process, which is exactly the leak this method exists to prevent. The first
   * error is rethrown afterwards so the failure is still visible.
   */
  function disposeAll() {
    // Snapshot the ids first: a disposer is allowed to touch the map.
    const ids = [...registrations.keys()]
    let firstError
    for (const agentId of ids) {
      try {
        release(agentId)
      } catch (error) {
        if (firstError === undefined) firstError = error
      }
    }
    if (firstError !== undefined) throw firstError
  }

  return { ensure, release, disposeAll }
}
