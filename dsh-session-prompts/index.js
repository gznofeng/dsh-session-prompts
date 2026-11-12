/**
 * dsh-session-prompts — host entry.
 *
 * Owns three things and delegates the rest:
 *   - the plugin context wiring (lib/host/lifecycle.js owns the in-memory `State`
 *     snapshot, its file lifecycle, and its mutators; store.js underneath owns
 *     the format),
 *   - per-agent section registration (lib/host/section.js owns idempotency and
 *     `interpolate: false`),
 *   - the loopback routes (lib/host/routes.js owns validation and the response
 *     envelopes).
 *
 * Design notes:
 *
 * - **State is read at activation and only re-read on demand.** `mutate`
 *   commits to memory only after the save resolves, so a failed write leaves the
 *   process serving what was last durable rather than a value the user believes
 *   was saved. The one way to pick up an externally changed file is
 *   `lifecycle.reload()`, which the settings page's Retry button drives through
 *   `POST .../reload` — without it, a file that was unreadable or unparsable at
 *   startup could never be recovered from without restarting the app, because
 *   every read and write answers from the snapshot of that failure.
 * - **A failed initial load is surfaced, never papered over.** `loadState` maps a
 *   missing file to an empty state, and flags an *unparsable* one instead of
 *   disguising it as empty (see `isCorrupt` in store.js); what it rethrows is a
 *   real I/O problem (permissions, the path is a directory). Substituting an
 *   empty state for any of these would invite the config page to "fix" it with a
 *   save over data that was merely unreadable. So a rethrown failure is logged,
 *   and both the routes (`state()` throws -> 500 with the reason) and the
 *   browser surface it; a corrupt file is served with `corrupt: true` so the
 *   page can warn, while `mutate` refuses to write at all. Only the prompt text
 *   degrades to empty, because a throwing `text` function would fail *every
 *   request in every session* (see lib/host/section.js). A `reload()` that still
 *   cannot read the file keeps refusing the same way — recovery only ever
 *   follows a file that now reads cleanly.
 * - **`webServer` is optional.** Sections work without a browser, so the plugin
 *   stays active where no web server exists and only the routes are skipped.
 * - **Sections are registered on `agent.ctx`,** never on this plugin's own
 *   context: a section registered here would be global and apply to every agent
 *   in the profile.
 */

import path from 'node:path'
import { homedir } from 'node:os'

import { createAgentSections } from './lib/host/section.js'
import { createRoutes } from './lib/host/routes.js'
import { createStateLifecycle } from './lib/host/lifecycle.js'

/** The single section name this plugin owns. Also the shadowing key in one scope. */
const SECTION_NAME = 'plugin:session-prompts'

/**
 * Placement among the assembled sections: after the first-party guidance
 * (10000) and the Web surface (10100), before the persona suffix (10200).
 * A constant because this plugin exports no `Config` (see the plan's rationale).
 */
const SECTION_ORDER = 10150

/** Directory for plugin-owned files under the Harness home. */
const PLUGIN_DATA_DIR = 'plugin-data'

/** File name inside {@link PLUGIN_DATA_DIR}. */
const STATE_FILE_NAME = 'dsh-session-prompts.json'

/**
 * Absolute path of this plugin's state file.
 *
 * `$DSH_HOME` wins when set (the desktop build always sets it); otherwise the
 * documented default `~/.dsh` applies. Resolved per call rather than at module
 * scope so a swapped environment is not masked by the first value.
 *
 * @returns {string}
 */
function stateFilePath() {
  const configured = process.env.DSH_HOME
  const home = typeof configured === 'string' && configured.trim() !== ''
    ? configured
    : path.join(homedir(), '.dsh')
  return path.join(home, PLUGIN_DATA_DIR, STATE_FILE_NAME)
}

/**
 * @param {any} ctx the plugin context
 */
export function apply(ctx) {
  const file = stateFilePath()

  /**
   * The state snapshot, its file lifecycle, and its commit chain.
   *
   * Created here, at activation, because the path is resolved from this
   * process's `$DSH_HOME`; the module it comes from (lib/host/lifecycle.js)
   * knows nothing about DSH and is drivable from a temp file in tests.
   */
  const lifecycle = createStateLifecycle({ file, logger: ctx.logger })

  /** agentId -> agent, so a section can be registered in that agent's own scope. */
  const agents = new Map()

  /**
   * The `parentSession` walk, read straight off the durable session header.
   *
   * No `origin` check: subagent lineage and forked sessions both record
   * `parentSession`, and a fork inheriting the parent's prompts is what a user
   * expects. A session that is not live has no parent, which ends the walk.
   *
   * `ctx.sessions` is a core service; the `ctx.get` fallback covers a profile
   * that composes it into a parent fiber, so inheritance cannot silently degrade
   * to "always root" just because this plugin never declared `sessions` in its
   * own inject list.
   *
   * @param {string} id
   * @returns {string | undefined}
   */
  function parentOf(id) {
    const sessions = ctx.sessions ?? ctx.get?.('sessions')
    const parent = sessions?.get?.(id)?.header?.parentSession
    return typeof parent === 'string' && parent !== '' ? parent : undefined
  }

  const sections = createAgentSections({
    // Reading through a closure keeps every call on the newest snapshot.
    getState: () => lifecycle.state(),
    parentOf,
    order: SECTION_ORDER,
    register: (agentId, def) => {
      const agent = agents.get(agentId)
      if (agent === undefined) throw new Error(`dsh-session-prompts: agent ${agentId} 的上下文不可用`)
      const systemPrompt = agent.ctx?.systemPrompt
      if (systemPrompt === undefined) throw new Error('dsh-session-prompts: agent 上下文里没有 systemPrompt 服务')
      return systemPrompt.section(def)
    },
  })

  const ready = lifecycle.ready

  // Everything below awaits `ready`, but a plugin that nobody calls into yet
  // would otherwise leave the rejection unhandled (and Node reports it as a
  // process-level warning). lifecycle.js already logs the failure and attaches
  // its own catch; this one covers the awaits in THIS file.
  ready.catch(() => {})

  // Fiber-owned teardown: both owners of every section registration — this
  // plugin's record and the agent's own scope — are released on unload.
  ctx.effect(() => () => sections.disposeAll())
  ctx.effect(() => () => agents.clear())

  ctx.on('agent/created', async ({ agent }) => {
    // Remembered before the startup read settles: `register` needs `agent.ctx`
    // itself, not just the id.
    agents.set(agent.id, agent)
    // The barrier, not the verdict: awaiting `ready` keeps an agent created
    // during startup from registering against a snapshot that has not landed
    // yet. The verdict is then asked of the CURRENT snapshot, because after a
    // successful `reload()` the startup promise is still the rejected one it
    // always was — judging by it would keep every newly created session
    // unregistered for the rest of the process, i.e. recovery would restore the
    // settings page but not the injection. `state()` throws exactly when the
    // file is (still) unreadable.
    await ready.then(() => null, () => null)
    let failure = null
    try {
      lifecycle.state()
    } catch (error) {
      failure = error
    }
    // A state file we could not read must not cost the user their session. The
    // load failed, so nothing would be injected either way; skipping the
    // registration keeps an always-empty section out of the assembly. A later
    // successful `reload` re-registers these agents (see `reloadState`).
    if (failure !== null) return
    // `agent/created` is serial and awaited, and a throw here FAILS session
    // creation. A cosmetic feature must never be the reason a session cannot
    // start, so a registration failure is logged and swallowed — this is the
    // caller decision `section.js` deliberately leaves open.
    try {
      sections.ensure(agent.id, SECTION_NAME)
    } catch (error) {
      ctx.logger?.warn?.('dsh-session-prompts: 注册 section 失败，该会话不会注入提示词', error)
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    // The section registration is scoped to `agent.ctx` and unwinds with the
    // agent, so the scope side needs no help here. Our own bookkeeping does:
    // a resumed session reuses its id, and a stale entry would turn the new
    // agent's `ensure` into a silent no-op that never re-registers.
    //
    // `agent/disposed` is a plain emit, not an awaited serial event, so a
    // throwing disposer would surface as an unhandled exception during teardown.
    // Losing the section for one dying agent is not worth that.
    try {
      sections.release(agent.id)
    } catch (error) {
      ctx.logger?.warn?.('dsh-session-prompts: 释放 section 失败', error)
    }
    agents.delete(agent.id)
  })

  /**
   * Re-read the state file, then repair the one thing a recovery invalidates.
   *
   * `sections.ensure` is idempotent, so the loop below is a no-op for every agent
   * that already has its section. It matters for the agents created while the
   * startup read was failing: those skipped registration entirely (see
   * `agent/created`), and without this they would keep injecting nothing for the
   * rest of their lives even though the file is healthy again.
   *
   * A section failure is logged and swallowed here exactly as it is in
   * `agent/created`: the file recovered, that is what this call was for, and a
   * registration problem must not turn it into an error the browser reports as
   * "the file is still broken".
   *
   * @returns {Promise<void>} rejects only when the file still cannot be read
   */
  async function reloadState() {
    await lifecycle.reload()
    for (const agentId of agents.keys()) {
      try {
        sections.ensure(agentId, SECTION_NAME)
      } catch (error) {
        ctx.logger?.warn?.('dsh-session-prompts: 恢复后注册 section 失败，该会话不会注入提示词', error)
      }
    }
  }

  /**
   * `deps` for the route layer.
   *
   * All three come straight from `lifecycle`, which is what keeps the state
   * machine in one place:
   *
   * - `state()` is the in-memory snapshot, so a read never touches disk.
   * - `mutate(fn)` computes the next state, persists it, and only then publishes
   *   it: a rejected save leaves memory on the last durable value and the route
   *   answers 500, so the browser never reports a change disk does not have.
   * - `reload()` re-reads the file and replaces the snapshot. This is the
   *   recovery path the settings page's Retry button drives; it is the ONLY way
   *   a corrupt or unreadable-at-startup file becomes healthy again without
   *   restarting the process, and it still refuses writes if the bytes are still
   *   unparsable, so it cannot launder a corrupt file into an empty one.
   *
   * @type {{
   *   state: () => any,
   *   mutate: (fn: (current: any) => any) => Promise<void>,
   *   reload: () => Promise<void>,
   * }}
   */
  // Nothing imports index.js, so this file has no direct test (ruled acceptable).
  // The corrupt-file write guard that used to live inline in `deps.mutate` moved
  // into lifecycle.js, where test/lifecycle.test.js pins it; what remains here is
  // a one-line delegation, i.e. defence-in-depth covered one layer down.
  const deps = {
    state: () => lifecycle.state(),
    mutate: fn => lifecycle.mutate(fn),
    reload: reloadState,
  }

  // Routes exist only where a web server does; without one the plugin still
  // activates and the section keeps working.
  ctx.inject(['webServer'], webCtx => {
    webCtx.effect(() => {
      const disposers = createRoutes(deps).map(route => webCtx.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    })
  })
}
