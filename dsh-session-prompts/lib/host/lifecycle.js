/**
 * dsh-session-prompts — the in-memory State snapshot and its file lifecycle.
 *
 * `store.js` owns the on-disk format and the pure mutators; this module owns
 * *when* the file is read and written. Three things live here, and nowhere else:
 *
 * - **The snapshot.** Read once at activation, replaced (never mutated) on every
 *   commit.
 * - **The commit path.** `mutate(fn)` computes the next state, persists it, and
 *   only then publishes it, so a failed save leaves the process serving what was
 *   last durable instead of a value the user believes was saved.
 * - **The explicit re-read.** `reload()` is the only code that touches the file
 *   again after activation. It exists because the alternative — a snapshot taken
 *   at startup and never refreshed — can never recover from a file that was
 *   unreadable or unparsable at that moment: every later read and write would
 *   answer from the memory of that failure, no matter how often the browser
 *   refreshes or retries. `reload()` is what makes the settings page's Retry
 *   button mean something.
 *
 * No DSH API is imported and the logger is optional, so a test can drive this
 * against a temp file (see test/lifecycle.test.js).
 */

import { emptyState, isCorrupt, loadState, saveState } from './store.js'

/**
 * Coerce a thrown value into an Error, so callers can rely on `.message`/`.code`.
 *
 * @param {unknown} error
 * @returns {Error}
 */
function toError(error) {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Load, serve, persist, and on demand re-read one state file.
 *
 * @param {object} options
 * @param {string} options.file absolute path of the state file
 * @param {{ error?: (message: string, error?: unknown) => void }} [options.logger]
 *   only ever used to log; a missing logger changes nothing but the record
 * @returns {{
 *   ready: Promise<void>,
 *   state: () => any,
 *   mutate: (fn: (current: any) => any) => Promise<void>,
 *   reload: () => Promise<void>,
 * }}
 */
export function createStateLifecycle({ file, logger }) {
  if (typeof file !== 'string' || file === '') {
    throw new TypeError('createStateLifecycle 需要状态文件路径')
  }

  /** The current snapshot, replaced (never mutated) on every load. */
  let state = emptyState()

  /** Whether {@link state} is the file's content rather than the placeholder. */
  let loaded = false

  /** The last load/reload failure, if any. Non-`null` makes every read and write refuse. */
  let loadError = null

  /**
   * Tail of the write chain. Every `mutate` and every `reload` runs strictly
   * after the previous one settles, so two concurrent operations cannot both
   * derive from the same snapshot, and a reload cannot land under a save.
   */
  let write = Promise.resolve()

  /** Rejects (and logs) when the state file cannot be read at all. */
  const ready = loadState(file).then(
    snapshot => {
      state = snapshot
      loaded = true
    },
    error => {
      loadError = toError(error)
      logger?.error?.('dsh-session-prompts: 读取状态文件失败', error)
      throw loadError
    },
  )

  // A plugin that nobody calls into yet would otherwise leave the rejection
  // unhandled (and Node reports it as a process-level warning). The log above is
  // the surfacing channel; `state()`/`mutate()` are where it reaches a caller.
  ready.catch(() => {})

  /**
   * The current snapshot.
   *
   * A read before the load settles must not answer `{ prompts: [], ticks: {} }`:
   * the browser cannot tell that apart from "the user has no prompts" and would
   * offer to create one. Refusing is the honest answer, and `routes.js` turns it
   * into a 500 with this message. A corrupt file is NOT a failure here — it is
   * served with its flag, which is what lets the page warn while `mutate` refuses
   * to write.
   *
   * @returns {any}
   */
  function read() {
    if (loadError !== null) throw loadError
    if (!loaded) throw new Error('状态尚未加载完成，请稍后重试')
    return state
  }

  /**
   * Compute, persist, then publish — serialized against every other write.
   *
   * The read (`fn(state)`) and the commit (`state = next`) straddle an
   * `await saveState`, so without a chain two overlapping mutations would both
   * derive from the same old snapshot and the later commit would silently drop
   * the earlier one — while that earlier route call had already answered 200
   * with a tick that no longer exists. The user sees a ticked checkbox, and a
   * refresh loses it (and the prompt was never injected). One mutation at a
   * time is the only correct shape for a read-modify-write over a shared
   * snapshot.
   *
   * **A corrupt state file is never written.** The bytes on disk could not be
   * parsed, so they may still be hand-recoverable; saving the flagged empty
   * state would replace them with `{ version, prompts: [], ticks: {} }`.
   * `routes.js` is the caller-facing guard; this one is defence-in-depth for any
   * other caller of `mutate`. Unlike the route guard it is NOT dead code — it is
   * the line that keeps a future in-process caller from overwriting a corrupt
   * file, and test/lifecycle.test.js covers it directly (no caller is left
   * relying on the route layer having checked first).
   *
   * The failure checks read the CURRENT flags rather than `ready`, because a
   * successful `reload()` clears `loadError` and clears the corrupt flag: a
   * write issued after a recovery must go through, and the startup promise —
   * which rejected and will never settle differently — must not be what gates
   * it. `ready` is still awaited, unjudged, so a write can never race the
   * initial read.
   *
   * Each call rejects to ITS OWN caller, so `routes.js` can answer 500; the
   * chain itself advances on a caught copy, so one failed save cannot wedge
   * every later write.
   *
   * @param {(current: any) => any} fn
   * @returns {Promise<void>}
   */
  function mutate(fn) {
    const run = write.then(async () => {
      await ready.catch(() => {})
      if (loadError !== null) throw loadError
      if (!loaded) throw new Error('状态尚未加载完成，请稍后重试')
      if (isCorrupt(state)) {
        throw new Error('状态文件无法解析，已拒绝写入以免覆盖仍可手工恢复的数据')
      }
      const next = fn(state)
      await saveState(file, next)
      // Committed only now: a throw above leaves `state` untouched.
      state = next
    })
    write = run.catch(() => {})
    return run
  }

  /**
   * Re-read the state file from disk, replacing the snapshot.
   *
   * The recovery path, and the only one: it is what lets a user who repaired
   * (or moved away) a broken file get back to a writable plugin without
   * restarting the app. Writes are still refused afterwards if the bytes are
   * still unparsable, so this cannot be used to launder a corrupt file into an
   * empty one.
   *
   * Chained on `write` like a mutation, and it awaits `ready` first: a reload
   * that ran concurrently with the startup read could be overwritten by it, or
   * have a stale startup failure written over a success.
   *
   * @returns {Promise<void>} rejects with the I/O failure when the file still
   *   cannot be read; a merely corrupt file resolves (its flag says why)
   */
  function reload() {
    const run = write.then(async () => {
      await ready.catch(() => {})
      try {
        const snapshot = await loadState(file)
        state = snapshot
        loaded = true
        loadError = null
      } catch (error) {
        // Kept as the reason every read and write now refuses: falling back to
        // the previous snapshot would hide an unreadable file behind data the
        // user can no longer see on disk.
        loadError = toError(error)
        logger?.error?.('dsh-session-prompts: 重新读取状态文件失败', error)
        throw loadError
      }
    })
    write = run.catch(() => {})
    return run
  }

  return { ready, state: read, mutate, reload }
}
