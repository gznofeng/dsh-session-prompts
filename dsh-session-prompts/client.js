window.__ModuleLoader__.load({
  id: 'dsh-session-prompts',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    /**
     * dsh-session-prompts — browser entry.
     *
     * THE ABSOLUTE RULE: this file is ONE self-contained artifact and must
     * NEVER `require` or `import` a relative path — not at module scope, not
     * inside a function, not lazily behind a condition, not in a dead branch.
     * The client module loader wraps this file in `window.__ModuleLoader__.load`
     * and has no other file to resolve against, so a relative specifier fails
     * EVERYWHERE it appears, at any depth, at the moment it is evaluated.
     *
     * The only imports allowed are the bare specifiers the loader's module
     * table already holds: `react` (and `react-dom` if a portal is ever needed).
     * Harness client packages are deliberately NOT imported: the slot system
     * arrives as the `slots` service, and the locale system as `locale`; every
     * control in this file is written here. Styles take COLOUR exclusively from
     * `--dsw-alias-*` theme tokens (so light and dark both read correctly) and
     * take WIDTH from the host's three `--dsh-composer-*` layout variables —
     * `--dsh-composer-side-clearance`, `--dsh-composer-dock-inset` and
     * `--dsh-composer-card-max-width` — which are how the composer dock lines
     * up with the input card. Those three carry lengths only, never a colour;
     * they are the same contract the shipped todo/goal/queue docks use, and
     * they are host-private (see the README's known limitations).
     *
     * Layout of this file, in order:
     *   1. copy (zh/en) and the translator
     *   2. the HTTP layer (four loopback routes)
     *   3. the shared store — ONE cache for every surface in this file
     *   4. the composer dock (`conversation.input.dock`) and its partition
     *   5. the settings page (`settings.section`) and the shared controls
     *   6. styles — ONE `<style>` element, shared by BOTH surfaces above
     *   7. `apply`: locale dictionaries, styles, both slot registrations
     */

    const React = require('react');
    const h = React.createElement;

    // =========================================================================
    // 1. Copy
    // =========================================================================

    /**
     * Dictionary namespace, registered through `locale.register` in `apply`.
     *
     * Also passed as the settings page's slot `locale`, so the host can resolve
     * the nav label through the same dictionary. The composer dock does NOT
     * declare it (see the registration's comment in `apply`); it renders only
     * through this file's injected `t`.
     */
    const DICT_NS = 'settings.session-prompts';

    /**
     * Both languages inline. The design doc's copy table is the source; keys are
     * added only for text this page actually renders.
     */
    const DICT = {
      zh: {
        nav: '会话提示词',
        description: '勾选在对话输入框上方进行；提示词只对模型可见，不写入对话记录。',
        add: '添加提示词',
        'label.title': '标题',
        'label.text': '正文',
        'label.kind': '类型',
        'order.up': '上移',
        'order.down': '下移',
        'label.titlePlaceholder': '给这条提示词起个名字',
        'label.textPlaceholder': '写要注入系统提示词的内容',
        'switch.enabled': '生效中',
        'switch.disabled': '已停用',
        'switch.pinned': '独立在对话框上方',
        'dialog.title': '提示',
        'dialog.pinnedNeedsEnabled':
          '只有「生效中」的提示词才能独立显示在对话框上方。请先开启「生效中」。',
        'dialog.confirm': '开启并独立显示',
        'dialog.cancel': '取消',
        'notice.pinCleared': '已关闭「生效中」，同时取消了独立显示',
        remove: '删除',
        'empty.title': '还没有会话提示词',
        'empty.hint': '添加一条，勾选后即可在对话里生效。',
        'hint.ticks': '仍有 {count} 个会话勾选着它',
        'status.loading': '加载中…',
        retry: '重试',
        'error.load': '读取提示词失败',
        'error.save': '保存失败',
        'error.remove': '删除失败',
        'error.network': '无法连接到插件服务',
        'error.protocol': '插件返回了无法识别的响应',
        'error.corrupt': '状态文件无法解析，为避免覆盖仍可手工恢复的内容，已停止写入。修好文件后点「重试」重新读取',
        'error.conflict': '这条提示词已被删除（可能来自另一个页面），请刷新后重试',
        'error.tick': '勾选失败',
        'error.insert': '插入失败，请重试',
        'error.kind': '这个页面比正在运行的插件新：服务端还不认识「类型」这个字段。重启 DSH 后再试',
        'dock.group': '提示词',
        'dock.groupCount': '提示词 · 已挂 {count} 条',
        'dock.quickGroup': '快速提示词',
        'dock.untitled': '未命名提示词',
        'kind.system': '系统提示词',
        'kind.quick': '快速提示词',
        'kind.systemHint': '勾选后注入到系统提示词，模型可见但对话里不留痕',
        'kind.quickHint': '点击后把正文填入对话框，不参与勾选',
      },
      en: {
        nav: 'Session prompts',
        description:
          'Tick prompts above the composer. They reach the model only and never enter the transcript.',
        add: 'Add prompt',
        'label.title': 'Title',
        'label.text': 'Prompt',
        'label.kind': 'Kind',
        'order.up': 'Move up',
        'order.down': 'Move down',
        'label.titlePlaceholder': 'Name this prompt',
        'label.textPlaceholder': 'The text to inject into the system prompt',
        'switch.enabled': 'Active',
        'switch.disabled': 'Inactive',
        'switch.pinned': 'Pin above the composer',
        'dialog.title': 'Notice',
        'dialog.pinnedNeedsEnabled':
          'Only active prompts can be pinned above the composer. Turn on Active first.',
        'dialog.confirm': 'Turn on and pin',
        'dialog.cancel': 'Cancel',
        'notice.pinCleared': 'Active turned off; pinning was cleared too',
        remove: 'Remove',
        'empty.title': 'No session prompts yet',
        'empty.hint': 'Add one and tick it to make it take effect in a conversation.',
        'hint.ticks': 'Still ticked in {count} session(s)',
        'status.loading': 'Loading…',
        retry: 'Retry',
        'error.load': 'Could not load the prompts',
        'error.save': 'Could not save',
        'error.remove': 'Could not remove',
        'error.network': 'Could not reach the plugin service',
        'error.protocol': 'The plugin returned a response this page cannot read',
        'error.corrupt':
          'The state file could not be parsed; writing is disabled so recoverable data is not overwritten. Fix the file, then choose Retry',
        'error.conflict': 'That prompt no longer exists (another page may have removed it) — reload and retry',
        'error.tick': 'Could not tick the prompt',
        'error.insert': 'Could not insert the text — try again',
        'error.kind':
          'This page is newer than the running plugin: the host does not recognize the Kind field yet. Restart DSH and try again',
        'dock.group': 'Prompts',
        'dock.groupCount': 'Prompts · {count} active',
        'dock.quickGroup': 'Quick prompts',
        'dock.untitled': 'Untitled prompt',
        'kind.system': 'System prompt',
        'kind.quick': 'Quick prompt',
        'kind.systemHint': 'Ticked prompts join the system prompt — the model sees them, the transcript does not',
        'kind.quickHint': 'Clicking one pastes its text into the composer; no ticking involved',
      },
    };

    /** Substitute `{name}` placeholders; unknown names are left verbatim. */
    function format(text, params) {
      if (typeof text !== 'string' || params === undefined || params === null) return text;
      return text.replace(/\{(\w+)\}/g, function (match, name) {
        return Object.hasOwn(params, name) ? String(params[name]) : match;
      });
    }

    /**
     * The active language, from the locale service when present and from the
     * browser otherwise. Only `zh` and `en` exist, so anything else is English,
     * which is also the terminal fallback the host's catalog guarantees.
     */
    function activeLanguage(locale) {
      try {
        const snapshot =
          typeof locale?.getLocale === 'function' ? locale.getLocale() : locale?.getSnapshot?.();
        if (snapshot !== null && typeof snapshot?.active === 'string' && snapshot.active !== '') {
          return snapshot.active.toLowerCase();
        }
      } catch {
        /* a locale service that cannot answer is exactly the fallback case */
      }
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
          return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
        }
      } catch {
        /* SSR-ish hosts have no navigator; English it is */
      }
      return 'en';
    }

    /**
     * One lookup, tolerant in every direction: missing language -> English,
     * missing key -> the key itself (visible enough to catch in review).
     */
    function lookup(language, key) {
      const table = DICT[language] ?? DICT.en;
      const value = table[key] ?? DICT.en[key];
      return typeof value === 'string' ? value : key;
    }

    /**
     * Build the `t(key, params)` this file renders through.
     *
     * `locale.bind(namespace)` is the host's own reader and is used when the
     * dictionaries registered; it returns the key itself when it has no entry,
     * which is why the inline table stays as the second source. Both paths
     * return the same strings, so a host without a working locale service
     * degrades to the inlined table instead of showing raw keys on screen.
     */
    function createTranslator(locale) {
      let bound;
      if (locale !== undefined && locale !== null && typeof locale.bind === 'function') {
        try {
          bound = locale.bind(DICT_NS);
        } catch {
          bound = undefined;
        }
      }
      return function t(key, params) {
        if (typeof bound === 'function') {
          let translated;
          try {
            translated = bound(key, params);
          } catch {
            translated = undefined;
          }
          if (typeof translated === 'string' && translated !== key) return translated;
        }
        return format(lookup(activeLanguage(locale), key), params);
      };
    }

    /** The translator used when a component is rendered without an injected `t`. */
    const fallbackT = createTranslator(undefined);

    // =========================================================================
    // 2. HTTP layer — the four loopback routes (verified against the host)
    // =========================================================================
    //
    //   GET  /plugins/dsh-session-prompts/state   -> { prompts, ticks, corrupt? }
    //   POST /plugins/dsh-session-prompts/prompts -> { prompts }
    //   POST /plugins/dsh-session-prompts/tick    -> { sessionId, tickIds }
    //   POST /plugins/dsh-session-prompts/reload  -> { prompts, ticks, corrupt? }
    //
    // `corrupt` is present ONLY when the host could not parse its state file. It
    // means "the bytes are still there but unreadable", so this page must warn
    // and must never write: the host refuses those writes too, but not offering
    // the action at all is what keeps the user from trying.
    //
    // `/reload` is the ONLY route that re-reads the file from disk, and it is
    // what the Retry button on a load failure calls. A plain `/state` read
    // answers from the host's snapshot, so retrying with it could never recover
    // from a file that was broken at startup — the same "corrupt file, no way
    // back" trap this page would then be advertising.
    //
    // Error answers are `{ error: "<readable message>" }` with 400/403/405/409/500.
    // That message is carried through untouched: it is the only explanation the
    // user gets ("只接受来自本机回环地址的请求" is a real thing to show).

    const API_BASE = '/plugins/dsh-session-prompts';

    /** Time the settings page waits after the last keystroke before saving. */
    const SAVE_DEBOUNCE_MS = 400;

    /** How long the "pinning was cleared too" notice stays on the card. */
    const NOTICE_MS = 4000;

    /** Textarea grows with its content up to this height, then scrolls. */
    const TEXTAREA_MAX_HEIGHT = 240;

    /**
     * An HTTP failure with enough shape for the UI to explain itself.
     *
     * The five codes are not interchangeable, because `errorDetail` localizes by
     * them instead of printing whatever text came back:
     *   - `'network'` — `fetch` itself rejected; the host was never reached.
     *   - `'http'`    — a 4xx/5xx whose message is the host's own readable text.
     *   - `'protocol'` — a 2xx whose body this page cannot read.
     *   - `'conflict'` — a 409: the prompt this write named no longer exists.
     *   - `'corrupt'`  — the host reported an unparsable state file, raised here
     *     by `assertWritable` before any request is sent.
     */
    class RequestError extends Error {
      /**
       * @param {string} message readable text, ideally the host's own
       * @param {'network' | 'http' | 'protocol' | 'conflict' | 'corrupt'} code which layer refused
       */
      constructor(message, code) {
        super(message);
        this.name = 'RequestError';
        this.code = code;
      }
    }

    /**
     * One request. Resolves the parsed JSON object or throws {@link RequestError}.
     *
     * `fetch` itself rejecting means the page could not talk to the host at all
     * (server gone, wrong origin) — that is a different story from a 4xx/5xx, so
     * it keeps a distinct code for the UI to localize.
     */
    async function requestJson(method, path, body) {
      const init = { method, credentials: 'same-origin' };
      if (body !== undefined) {
        init.headers = { 'content-type': 'application/json' };
        init.body = JSON.stringify(body);
      }

      let response;
      try {
        response = await fetch(path, init);
      } catch (cause) {
        throw new RequestError(
          cause instanceof Error && cause.message !== '' ? cause.message : String(cause),
          'network',
        );
      }

      let payload;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }

      if (!response.ok) {
        const reported =
          payload !== null && typeof payload === 'object' && typeof payload.error === 'string'
            ? payload.error.trim()
            : '';
        // A 409 is the host saying "this prompt no longer exists" (an upsert
        // named an unknown id — the state it would create is gone). Its message
        // is host-side Chinese, so this page localizes the situation itself
        // instead of printing it on an English UI.
        const code = response.status === 409 ? 'conflict' : 'http';
        throw new RequestError(reported !== '' ? reported : 'HTTP ' + response.status, code);
      }
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        // A technical message, never shown as-is: the page localizes by `code`
        // (see `InlineError`), so this only ever reaches a console or a log.
        throw new RequestError('response is not a JSON object', 'protocol');
      }
      return payload;
    }

    /**
     * Normalize a `/state` or `/reload` body into this page's data shape.
     *
     * Defensive only: the host always answers both keys, and a page that crashes
     * on a missing one is worse than an empty list. The corruption flag is
     * normalized to a strict boolean here so no consumer has to distinguish
     * `false` from absent. Shared by both read-shaped calls so they cannot drift:
     * a retry that normalized differently from a plain read would make recovery
     * look like a different state than the next refresh.
     *
     * @param {any} payload
     * @returns {{ prompts: any[], ticks: Record<string, string[]>, corrupt: boolean }}
     */
    function normalizeState(payload) {
      return {
        prompts: Array.isArray(payload.prompts) ? payload.prompts : [],
        ticks:
          payload.ticks !== null && typeof payload.ticks === 'object' && !Array.isArray(payload.ticks)
            ? payload.ticks
            : {},
        corrupt: payload.corrupt === true,
      };
    }

    const api = {
      /** @returns {Promise<{ prompts: any[], ticks: Record<string, string[]>, corrupt: boolean }>} */
      async readState() {
        return normalizeState(await requestJson('GET', API_BASE + '/state'));
      },
      /**
       * Ask the host to re-read its state file from disk.
       *
       * The recovery path: a plain `readState` answers from the host's snapshot,
       * so it can never see a file the user just repaired. This POST is the only
       * call that makes the host look at disk again.
       *
       * The `{}` body is not decoration: the route layer refuses an empty POST
       * body outright (the same rule the two write routes follow), so omitting it
       * would turn a recovery attempt into a 400.
       *
       * @returns {Promise<{ prompts: any[], ticks: Record<string, string[]>, corrupt: boolean }>}
       */
      async reloadState() {
        return normalizeState(await requestJson('POST', API_BASE + '/reload', {}));
      },
      /** Create (no `id`) or patch (with `id`) one prompt. */
      upsertPrompt(prompt) {
        return requestJson('POST', API_BASE + '/prompts', { op: 'upsert', prompt });
      },
      /** Delete one prompt by id. Tick records survive on the host by design. */
      deletePrompt(id) {
        return requestJson('POST', API_BASE + '/prompts', { op: 'delete', id });
      },
      /** Toggle one prompt for one session (single-item write, never a set). */
      tick(sessionId, promptId, on) {
        return requestJson('POST', API_BASE + '/tick', { sessionId, promptId, on });
      },
    };

    /** Normalize anything thrown into `{ code, message }` for rendering. */
    function serializeError(error) {
      if (error instanceof RequestError) return { code: error.code, message: error.message };
      if (error instanceof Error) return { code: 'unknown', message: error.message };
      return { code: 'unknown', message: String(error) };
    }

    // =========================================================================
    // 3. The shared store
    // =========================================================================
    //
    // ONE cache per loaded copy of this file, created inside the factory closure
    // so every surface registered from this file shares it. Snapshot shape:
    //
    //   { status: 'loading' | 'ready' | 'error', loaded: boolean,
    //     error: { code, message } | null,
    //     data: { prompts, ticks, corrupt } }
    //
    // `loaded` is what keeps a failed first read from looking like "the user has
    // no prompts": the page renders an error instead of the empty state, so
    // nobody is invited to "fix" a state file that was merely unreadable.
    //
    // `data.corrupt` is the second half of that story: the host DID answer 200,
    // but told us its file could not be parsed. The page then renders an error
    // state (and offers no "add"), and every write closure below refuses before
    // touching the network — the host would refuse anyway, and a request that is
    // known to fail should not be sent.

    function createStore() {
      const listeners = new Set();
      let snapshot = {
        status: 'loading',
        loaded: false,
        error: null,
        data: { prompts: [], ticks: {}, corrupt: false },
      };

      /** The in-flight read, plus "a caller arrived mid-read, read again". */
      let inFlight;
      let rerun = false;
      /**
       * The source the loop uses for its next iteration.
       *
       * `'state'` answers from the host's snapshot; `'reload'` makes the host
       * re-read its file from disk. A queued reload UPGRADES a queued plain read
       * and never the other way round — the whole point of a retry after a
       * corrupt file is that memory is stale and disk is not.
       */
      let nextSource = 'state';

      function publish(next) {
        snapshot = next;
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch (error) {
            // A broken subscriber must not stop the others from re-rendering.
            console.error('dsh-session-prompts: 订阅者抛错', error);
          }
        }
      }

      /**
       * One read, from `source`.
       *
       * @param {'state' | 'reload'} source
       */
      async function readOnce(source) {
        try {
          const data = source === 'reload' ? await api.reloadState() : await api.readState();
          publish({ status: 'ready', loaded: true, error: null, data });
        } catch (error) {
          // Never rejects: a failed read is state, not an exception the caller
          // has to handle. The last good data stays so a transient failure does
          // not blank the page.
          publish({
            status: 'error',
            loaded: snapshot.loaded,
            error: serializeError(error),
            data: snapshot.data,
          });
        }
      }

      /** @returns {() => void} unsubscribe */
      function subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }

      /** @returns {typeof snapshot} the current snapshot (stable between changes) */
      function getSnapshot() {
        return snapshot;
      }

      /**
       * Re-read `/state`.
       *
       * A call that lands while a read is in flight marks one rerun and awaits
       * that read, so it is guaranteed to reflect a write issued BEFORE the
       * call — without that, a toggle followed by an immediate refresh could
       * render the pre-toggle snapshot and stay wrong.
       *
       * @returns {Promise<void>} settles once this call's freshness is reflected
       */
      function refresh() {
        return read('state');
      }

      /**
       * Re-read, but ask the host to touch disk first.
       *
       * This is what the Retry button on a load failure calls — the ONE case
       * where the host's in-memory snapshot is known to be suspect (an
       * unparsable file at startup, an unreadable one, a file another process
       * rewrote). Plain `refresh()` answers from that snapshot, so using it
       * there would make the button look like it works while never being able to
       * succeed.
       *
       * @returns {Promise<void>}
       */
      function reloadState() {
        return read('reload');
      }

      /**
       * The shared read loop.
       *
       * `nextSource` carries the strongest source across a mid-flight call, so a
       * retry requested while a plain read is in flight still ends up re-reading
       * disk instead of silently downgrading to the snapshot.
       *
       * @param {'state' | 'reload'} source
       * @returns {Promise<void>}
       */
      function read(source) {
        if (source === 'reload') nextSource = 'reload';
        if (inFlight !== undefined) {
          rerun = true;
          return inFlight;
        }
        const run = readUntilSettled();
        inFlight = run;
        return run;
      }

      async function readUntilSettled() {
        try {
          do {
            rerun = false;
            const source = nextSource;
            nextSource = 'state';
            await readOnce(source);
          } while (rerun);
        } finally {
          inFlight = undefined;
        }
      }

      /**
       * Refuse a write while the host reports a corrupt state file.
       *
       * Checked here, in the one place every write funnels through, so no
       * surface can forget it. The host refuses too (500) — this only spares the
       * user a round trip that is known to fail, and keeps a surface that somehow
       * still offers an action from silently doing nothing.
       *
       * @throws {RequestError} code `corrupt`, localized by `InlineError`
       */
      function assertWritable() {
        if (snapshot.data.corrupt !== true) return;
        throw new RequestError('the state file could not be parsed', 'corrupt');
      }

      /**
       * Write one prompt, then refresh.
       *
       * Resolves the host's `{ prompts }` so the caller can spot what it just
       * created (the id is generated on the host). Rejects when the write itself
       * failed — that is the caller's error to show on its own card.
       *
       * @param {object} prompt a full or partial prompt; no `id` creates one
       * @returns {Promise<{ prompts: any[] }>}
       */
      async function upsert(prompt) {
        assertWritable();
        const payload = await api.upsertPrompt(prompt);
        await refresh();
        return payload;
      }

      /**
       * Delete one prompt, then refresh.
       *
       * @param {string} id
       * @returns {Promise<{ prompts: any[] }>}
       */
      async function remove(id) {
        assertWritable();
        const payload = await api.deletePrompt(id);
        await refresh();
        return payload;
      }

      /**
       * Move one prompt one slot earlier or later in the single global order.
       *
       * The order is global across both kinds: the strip renders one sequence,
       * so a per-kind order would leave no way to put a quick prompt before a
       * system prompt. Positions are renumbered `0..n-1` from the array's
       * current order (which is `order`, then array position), so repeated moves
       * cannot drift into colons of equal `order` values.
       *
       * Only the two swapped prompts are written: one request each, issued in
       * sequence so the second lands on the first's result. Writing every prompt
       * would be a burst of N writes for one click.
       *
       * @param {string} id
       * @param {-1 | 1} direction negative moves earlier, positive later
       * @returns {Promise<boolean>} whether anything moved
       */
      async function move(id, direction) {
        assertWritable();
        const ordered = sortPrompts(snapshot.data.prompts);
        const from = ordered.findIndex(prompt => prompt && prompt.id === id);
        if (from < 0) return false;
        const to = from + direction;
        if (to < 0 || to >= ordered.length) return false;

        // Only two positions actually change when two neighbours swap, so only
        // those two records are written: one click must not cost N requests.
        const neighbour = ordered[to];
        const movedOrder = Number.isFinite(ordered[from].order) ? ordered[from].order : from;
        const neighbourOrder = Number.isFinite(neighbour.order) ? neighbour.order : to;
        // Equal `order` values are the degenerate case: fall back to the array
        // positions so the swap still produces a strict change.
        const nextMoved = movedOrder === neighbourOrder ? to : neighbourOrder;
        const nextNeighbour = movedOrder === neighbourOrder ? from : movedOrder;

        await api.upsertPrompt({ id: ordered[from].id, order: nextMoved });
        await api.upsertPrompt({ id: neighbour.id, order: nextNeighbour });
        await refresh();
        return true;
      }

      /**
       * Toggle one prompt for one session, then refresh.
       *
       * Task 6 does not call this; the composer dock of Task 7 does. It lives
       * here so both surfaces share one fetch path and one cache.
       *
       * @param {string} sessionId
       * @param {string} promptId
       * @param {boolean} on
       * @returns {Promise<{ sessionId: string, tickIds: string[] }>}
       */
      async function toggleTick(sessionId, promptId, on) {
        assertWritable();
        const payload = await api.tick(sessionId, promptId, on);
        await refresh();
        return payload;
      }

      // A plain object of closures: no method depends on `this`, so a surface may
      // destructure any of them.
      return { subscribe, getSnapshot, refresh, reloadState, upsert, remove, move, toggleTick };
    }

    /** The singleton every surface in this file reads and writes. */
    const store = createStore();

    // =========================================================================
    // 4. The composer dock (`conversation.input.dock`, id `session-prompts`)
    // =========================================================================
    //
    // The second surface in THIS file, and the reason the store above is a
    // module singleton rather than a per-component cache: ticking here has to
    // move the settings page's "still ticked in N sessions" hints, and renaming
    // a prompt in settings has to move the labels here. Both surfaces read
    // `store.getSnapshot()` (through `useSnapshot`) and write through the same
    // store closures, so one publish re-renders both.
    //
    // Two layers, per the design doc:
    //   * `pinned` entries — one always-present row each, ticked or not;
    //   * everything else — ONE group row (`提示词 · 已挂 N 条`) that expands in
    //     place into checkbox rows.
    // `已挂 N 条` counts ONLY ticked grouped entries: a pinned row displays its
    // own state, so counting it as well would report the wrong number.

    /**
     * Sessions whose group is expanded.
     *
     * Deliberately outside the component: a session-scoped slot entry remounts
     * when the active session changes, and the design doc requires the
     * expansion state to be remembered per session — A expanded must not affect
     * B. A `Set` of session ids is the whole feature's memory.
     */
    const expandedSessions = new Set();

    /**
     * One expansion slot per group, per session.
     *
     * The strip now carries two independent groups (system prompts and quick
     * prompts). Remembering them under one key would make expanding one group
     * silently expand the other, so each group gets its own namespaced key while
     * the storage stays the same per-session set.
     *
     * @param {string} sessionId
     * @returns {string}
     */
    function systemKey(sessionId) {
      return sessionId + '\u0000system';
    }

    /** @param {string} sessionId @returns {string} */
    function quickKey(sessionId) {
      return sessionId + '\u0000quick';
    }

    /**
     * The prompt ids this session ticks.
     *
     * Tolerant in every direction: a missing session key, a non-array value and
     * junk entries all degrade to "nothing ticked" instead of throwing on an
     * unreadable state file.
     *
     * @returns {string[]}
     */
    function tickedIdsFor(ticks, sessionId) {
      if (sessionId === '' || ticks === null || typeof ticks !== 'object') return [];
      if (!Object.hasOwn(ticks, sessionId)) return [];
      const ids = ticks[sessionId];
      if (!Array.isArray(ids)) return [];
      return ids.filter(id => typeof id === 'string' && id !== '');
    }

    /**
     * Whether one prompt is ticked for this session.
     *
     * `overrides` holds the row-level optimistic values of a pending write and
     * wins over the last published snapshot; an id with no override falls back
     * to the store. Used by BOTH the checkbox and the group count, so one click
     * can never move one and not the other.
     *
     * @param {string[]} tickedIds the store's tick list for this session
     * @param {Record<string, boolean>} overrides optimistic per-row values
     * @param {string} id
     */
    function isTicked(tickedIds, overrides, id) {
      if (overrides !== null && overrides !== undefined && Object.hasOwn(overrides, id)) {
        return overrides[id] === true;
      }
      return tickedIds.includes(id);
    }

    /**
     * How many GROUPED entries this session ticks.
     *
     * Pinned entries are excluded on purpose: a pinned row displays its own
     * state, so counting it here too would report a bigger number than the user
     * can account for in the collapsed group.
     *
     * @param {any[]} grouped
     * @param {string[]} tickedIds
     * @param {Record<string, boolean>} overrides
     * @returns {number}
     */
    function countGroupedTicked(grouped, tickedIds, overrides) {
      let count = 0;
      for (const prompt of grouped) {
        if (isTicked(tickedIds, overrides, prompt.id)) count += 1;
      }
      return count;
    }

    /**
     * Split the visible prompts into the dock's two layers.
     *
     * Only `enabled` prompts appear at all: "off" is a real switch that stops
     * both injection and visibility (state matrix, row 1). `pinned ⇒ enabled`
     * is enforced by the host, but filtering by `enabled` first makes the dock
     * right even if a hand-edited state file slips the invariant through.
     *
     * The `已挂 N 条` count is deliberately NOT computed here: it has to account
     * for rows with a tick still in flight, so it lives with the component as
     * {@link countGroupedTicked} over this result plus the override map. One
     * implementation, used by both the count and the checkboxes.
     *
     * @param {any[]} prompts the `/state` prompt list
     * @param {Record<string, string[]>} ticks the `/state` tick map
     * @param {string} sessionId the session whose ticks count
     * @returns {{ pinned: any[], grouped: any[], quickPinned: any[], quick: any[], tickedIds: string[] }}
     */
    function partition(prompts, ticks, sessionId) {
      const tickedIds = tickedIdsFor(ticks, sessionId);
      const pinned = [];
      const grouped = [];
      const quickPinned = [];
      const quick = [];
      for (const prompt of Array.isArray(prompts) ? prompts : []) {
        if (prompt === null || typeof prompt !== 'object') continue;
        if (typeof prompt.id !== 'string' || prompt.id === '') continue;
        if (prompt.enabled !== true) continue;
        // Both kinds honour `pinned`: a pinned row sits inline in the strip, an
        // unpinned one lives in its group's popup. The kind decides what a click
        // does (tick vs insert), not where the row appears.
        if (prompt.kind === 'quick') {
          (prompt.pinned === true ? quickPinned : quick).push(prompt);
          continue;
        }
        (prompt.pinned === true ? pinned : grouped).push(prompt);
      }
      return {
        pinned: sortPrompts(pinned),
        grouped: sortPrompts(grouped),
        quickPinned: sortPrompts(quickPinned),
        quick: sortPrompts(quick),
        tickedIds,
      };
    }

    /** 16px list glyph for the group row; `currentColor`, so it follows the theme. */
    const GROUP_GLYPH = h(
      'svg',
      {
        className: 'dsp-dock-glyph',
        viewBox: '0 0 16 16',
        width: 16,
        height: 16,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        'aria-hidden': 'true',
      },
      h('path', { d: 'M2.5 4.5h11' }),
      h('path', { d: 'M2.5 8h11' }),
      h('path', { d: 'M2.5 11.5h7' }),
    );

    /**
     * The navigation glyph for this settings section (`settings.section.icon`).
     *
     * A speech bubble with a check inside: the page's subject is a *prompt* that
     * is *on*, so the mark says both. Drawn with `currentColor` and no fill, so
     * the shell's own selected/unselected colouring passes straight through and
     * nothing hardcodes a palette.
     *
     * The shell supplies `size` (px) and `active`; the viewBox stays 16 so one
     * drawing serves every size, and `active` is ignored on purpose — the shell
     * owns that state, and a glyph that re-coloured itself would fight it.
     *
     * @param {{ size?: number, active?: boolean }} props
     */
    function SectionIcon(props) {
      const size = typeof props?.size === 'number' && props.size > 0 ? props.size : 16;
      return h(
        'svg',
        {
          className: 'dsp-section-icon',
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        // Bubble: a rounded rect with a tail at the lower left.
        h('path', { d: 'M3 3.4h10a1.2 1.2 0 0 1 1.2 1.2v5.2A1.2 1.2 0 0 1 13 11H7.1L4 13.1V11H3a1.2 1.2 0 0 1-1.2-1.2V4.6A1.2 1.2 0 0 1 3 3.4z' }),
        // Check inside the bubble.
        h('path', { d: 'M5.4 6.9l1.7 1.7 3.5-3.4' }),
      );
    }

    /** 16px bolt glyph for quick prompts: an action, not a checklist. */
    const QUICK_GLYPH = h(      'svg',
      {
        className: 'dsp-dock-glyph',
        viewBox: '0 0 16 16',
        width: 16,
        height: 16,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
      h('path', { d: 'M8.5 1.5 4 9h3.5L7 14.5 12 7H8.5z' }),
    );

    /**
     * The tick strip above the composer.
     *
     * Renders `null` — no empty strip, no placeholder — when there is nothing to
     * tick: no session, the state was never read (this is also how a remote
     * browser degrades, since the loopback routes answer it 403), the state file
     * could not be parsed, or no prompt is `enabled`.
     *
     * A corrupt state is silent here on purpose: the strip is the injection
     * control, and there is nothing injectable to show. The settings page is
     * where a corrupt file is explained, and it refuses every write.
     */
    function Dock(props) {
      const t = typeof props?.t === 'function' ? props.t : fallbackT;
      const sessionId = typeof props?.sessionId === 'string' ? props.sessionId : '';
      const snapshot = useSnapshot(store);
      const [expanded, setExpanded] = React.useState(
        () => sessionId !== '' && expandedSessions.has(systemKey(sessionId)),
      );
      const [quickExpanded, setQuickExpanded] = React.useState(
        () => sessionId !== '' && expandedSessions.has(quickKey(sessionId)),
      );
      /** Rows mid-POST: wins over the store snapshot until the write settles. */
      const [overrides, setOverrides] = React.useState({});
      /** Failure per row, rendered under the row it belongs to. */
      const [errors, setErrors] = React.useState({});
      /** Guards the post-await `setState`s against an already-unmounted dock. */
      const alive = React.useRef(true);

      React.useEffect(
        () => () => {
          alive.current = false;
        },
        [],
      );

      // A remembered expansion belongs to its session, never to this instance.
      // A session-scoped entry normally remounts on a switch; if it ever does
      // not, this also keeps one session's optimistic rows and errors from
      // leaking into another's.
      React.useEffect(() => {
        setExpanded(sessionId !== '' && expandedSessions.has(systemKey(sessionId)));
        setQuickExpanded(sessionId !== '' && expandedSessions.has(quickKey(sessionId)));
        setOverrides({});
        setErrors({});
      }, [sessionId]);

      // One read per mount: another surface (or another browser) may have
      // written since this file was evaluated.
      React.useEffect(() => {
        void store.refresh();
      }, []);

      const view = React.useMemo(
        () => partition(snapshot.data.prompts, snapshot.data.ticks, sessionId),
        [snapshot.data, sessionId],
      );

      // The count must follow an optimistic click as immediately as the
      // checkbox does, or the row would read `☑ 标题` while the group row still
      // says `已挂 N 条` with the old N. Same helper, same override map.
      const groupedTicked = React.useMemo(
        () => countGroupedTicked(view.grouped, view.tickedIds, overrides),
        [view, overrides],
      );

      // Every hook above runs unconditionally, so these early exits are safe.
      if (sessionId === '') return null;
      if (snapshot.loaded !== true) return null;
      if (view.pinned.length === 0 && view.grouped.length === 0 && view.quick.length === 0 && view.quickPinned.length === 0) {
        return null;
      }

      /** Drop one row's optimistic value, so the store is the truth again. */
      function forgetOverride(id) {
        setOverrides(current => {
          if (!Object.hasOwn(current, id)) return current;
          const next = { ...current };
          delete next[id];
          return next;
        });
      }

      /** Drop one row's inline error. */
      function forgetError(id) {
        setErrors(current => {
          if (!Object.hasOwn(current, id)) return current;
          const next = { ...current };
          delete next[id];
          return next;
        });
      }

      /**
       * Tick or untick one prompt for this session.
       *
       * Optimistic by design: the row flips on the click and the POST follows;
       * a rejected write rolls that row back and explains itself beneath it. A
       * failed tick must never leave a checkbox claiming something the host
       * refused — the strip is the only place this state is visible at all.
       */
      async function toggle(prompt, next) {
        const id = prompt.id;
        setOverrides(current => ({ ...current, [id]: next }));
        forgetError(id);
        try {
          await store.toggleTick(sessionId, id, next);
          if (!alive.current) return;
          // The refresh inside `toggleTick` already published the host's own
          // answer, so the local guess can go.
          forgetOverride(id);
        } catch (caught) {
          if (!alive.current) return;
          forgetOverride(id);
          setErrors(current => ({ ...current, [id]: serializeError(caught) }));
        }
      }

      function toggleGroup() {
        const next = !expanded;
        setExpanded(next);
        const key = systemKey(sessionId);
        if (next) expandedSessions.add(key);
        else expandedSessions.delete(key);
      }

      function toggleQuickGroup() {
        const next = !quickExpanded;
        setQuickExpanded(next);
        const key = quickKey(sessionId);
        if (next) expandedSessions.add(key);
        else expandedSessions.delete(key);
      }

      /**
       * Append one quick prompt's text into the composer draft.
       *
       * The composer's own insertion API is the only supported way in: it takes
       * one undoable edit against a captured selection, so this cannot clobber
       * the user's draft history. A non-empty draft gets a blank line first, so
       * a snippet never welds itself onto the end of the previous sentence.
       *
       * @param {any} prompt
       */
      function insertQuick(prompt) {
        const text = typeof prompt.text === 'string' ? prompt.text : '';
        if (text.trim() === '') return;
        const actions = props?.inputActions;
        if (actions === undefined || typeof actions.captureInsertion !== 'function') {
          setErrors(current => ({ ...current, [prompt.id]: { code: 'insert' } }));
          return;
        }

        // `captureInsertion()` returns the draft's current span (its selection +
        // revision); `insertText(text, span)` applies one undoable edit only
        // while that revision is still current. The host exposes no reader for
        // the draft's text, so whether to prepend a blank line is decided from
        // the `input` prop instead — `props.input.text` is the published draft.
        const span = actions.captureInsertion();
        if (span === null || span === undefined) {
          setErrors(current => ({ ...current, [prompt.id]: { code: 'insert' } }));
          return;
        }

        const draft = typeof props?.input?.text === 'string' ? props.input.text : '';
        const separator = draft.trim() === '' ? '' : '\n\n';
        const outcome = actions.insertText(separator + text, span);

        // A stale revision (the user typed between capture and insert) comes
        // back rejected; nothing was inserted, so the row must say so.
        if (outcome !== null && outcome !== undefined && outcome.ok === false) {
          setErrors(current => ({ ...current, [prompt.id]: { code: 'insert' } }));
          return;
        }
        forgetError(prompt.id);
      }

      function renderRow(prompt) {
        const id = prompt.id;
        const ticked = isTicked(view.tickedIds, overrides, id);
        const error = Object.hasOwn(errors, id) ? errors[id] : null;
        const title =
          typeof prompt.title === 'string' && prompt.title !== ''
            ? prompt.title
            : t('dock.untitled');
        const children = [
          h(
            // A `<label>` around a native checkbox: clicking the title toggles
            // too, and Tab/Space/`aria-checked` come from the element itself.
            'label',
            {
              key: 'row',
              className: 'dsp-dock-row',
            },
            h('input', {
              type: 'checkbox',
              className: 'dsp-dock-check',
              checked: ticked,
              onChange: () => void toggle(prompt, !ticked),
            }),
            h('span', { className: 'dsp-dock-title', title }, title),
          ),
        ];
        if (error !== null) {
          children.push(
            h(
              'div',
              { key: 'error', className: 'dsp-dock-error', role: 'alert' },
              h('span', { className: 'dsp-dock-error-prefix' }, t('error.tick')),
              h('span', { className: 'dsp-dock-error-detail' }, errorDetail(t, error)),
            ),
          );
        }
        // Indentation is the container's job: the same row renders flush in a
        // popup and inline in the strip, driven by `.dsp-dock-popover`.
        return h('div', { key: id, className: 'dsp-dock-item' }, children);
      }

      /**
       * One quick-prompt row: a plain button, deliberately WITHOUT a checkbox.
       *
       * A quick prompt is an action (paste this text), not a state (keep this
       * on). A tick box would imply the text stays on afterwards, which is the
       * opposite of what clicking it does.
       */
      function renderQuickRow(prompt) {
        const id = prompt.id;
        const error = Object.hasOwn(errors, id) ? errors[id] : null;
        const title =
          typeof prompt.title === 'string' && prompt.title !== ''
            ? prompt.title
            : t('dock.untitled');
        const children = [
          h(
            'button',
            {
              key: 'row',
              type: 'button',
              className: 'dsp-dock-row dsp-dock-quick-row',
              onClick: () => insertQuick(prompt),
            },
            QUICK_GLYPH,
            h('span', { className: 'dsp-dock-title', title }, title),
          ),
        ];
        if (error !== null) {
          children.push(
            h(
              'div',
              { key: 'error', className: 'dsp-dock-error', role: 'alert' },
              h('span', { className: 'dsp-dock-error-prefix' }, t('error.insert')),
              h('span', { className: 'dsp-dock-error-detail' }, errorDetail(t, error)),
            ),
          );
        }
        return h('div', { key: id, className: 'dsp-dock-item' }, children);
      }

      /**
       * One group: its own popup list stacked directly ABOVE its own button.
       *
       * Each group owns its list instead of the strip stacking every list at the
       * top: that is what makes a popup feel anchored to the control it came
       * from. The popup is in normal flow (not absolutely positioned), so it
       * pushes the strip down rather than covering the composer — the composer
       * sits below and must never be overdrawn.
       *
       * @param {object} options
       * @param {string} options.key react key
       * @param {boolean} options.open
       * @param {Array<any>} options.rows the popup's rows
       * @param {any} options.control the button that toggles it
       * @returns {any}
       */
      function renderGroup({ key, open, rows, control }) {
        return h(
          'div',
          { key, className: 'dsp-dock-group-wrap' },
          open && rows.length > 0
            ? h(
                'div',
                {
                  className: 'dsp-dock-popover',
                  role: 'group',
                  'aria-label': t('dock.group'),
                },
                rows,
              )
            : null,
          control,
        );
      }

      // The strip is a row of groups, each with its popup above its own button.
      const strip = [];

      if (view.grouped.length > 0) {
        const rows = [];
        for (const prompt of view.grouped) rows.push(renderRow(prompt));
        strip.push(
          renderGroup({
            key: '__group',
            open: expanded,
            rows,
            control: h(
              'button',
              {
                type: 'button',
                className: 'dsp-dock-group',
                'aria-expanded': expanded,
                onClick: toggleGroup,
              },
              GROUP_GLYPH,
              h(
                'span',
                { className: 'dsp-dock-group-title' },
                groupedTicked > 0
                  ? t('dock.groupCount', { count: groupedTicked })
                  : t('dock.group'),
              ),
              h(
                'span',
                { className: 'dsp-dock-chevron', 'aria-hidden': 'true' },
                expanded ? '▴' : '▾',
              ),
            ),
          }),
        );
      }

      if (view.quick.length > 0) {
        const rows = [];
        for (const prompt of view.quick) rows.push(renderQuickRow(prompt));
        strip.push(
          renderGroup({
            key: '__quick',
            open: quickExpanded,
            rows,
            control: h(
              'button',
              {
                type: 'button',
                className: 'dsp-dock-group',
                'aria-expanded': quickExpanded,
                onClick: toggleQuickGroup,
              },
              QUICK_GLYPH,
              h('span', { className: 'dsp-dock-group-title' }, t('dock.quickGroup')),
              h(
                'span',
                { className: 'dsp-dock-chevron', 'aria-hidden': 'true' },
                quickExpanded ? '▴' : '▾',
              ),
            ),
          }),
        );
      }

      // Pinned rows appear in ONE global order across both kinds, so the user's
      // arrangement in the settings page is exactly what they see here.
      const inlineRows = []
        .concat(view.pinned.map(prompt => ({ prompt, quick: false })))
        .concat(view.quickPinned.map(prompt => ({ prompt, quick: true })));
      inlineRows.sort((a, b) => {
        const left = Number.isFinite(a.prompt.order) ? a.prompt.order : 0;
        const right = Number.isFinite(b.prompt.order) ? b.prompt.order : 0;
        return left - right;
      });
      for (const entry of inlineRows) {
        strip.push(entry.quick ? renderQuickRow(entry.prompt) : renderRow(entry.prompt));
      }

      return h('div', { className: 'dsp-dock' }, [
        h('div', { key: '__strip', className: 'dsp-dock-strip' }, strip),
      ]);
    }

    // =========================================================================
    // 5. Components
    // =========================================================================

    /**
     * Subscribe to the store.
     *
     * `useSyncExternalStore` is the correct reader on React 18 (tearing-free and
     * sync with the snapshot); the effect-based fallback keeps the page alive on
     * an older React in the module table rather than crashing the slot.
     */
    const useSnapshot = typeof React.useSyncExternalStore === 'function'
      ? function useExternalSnapshot(target) {
          return React.useSyncExternalStore(target.subscribe, target.getSnapshot);
        }
      : function useFallbackSnapshot(target) {
          const [value, setValue] = React.useState(target.getSnapshot);
          React.useEffect(() => {
            setValue(target.getSnapshot());
            return target.subscribe(() => setValue(target.getSnapshot()));
          }, [target]);
          return value;
        };

    /** How many sessions currently tick one prompt (the `ticks` map of `/state`). */
    function countSessionsTicking(ticks, promptId) {
      if (ticks === null || typeof ticks !== 'object') return 0;
      let count = 0;
      for (const ids of Object.values(ticks)) {
        if (Array.isArray(ids) && ids.includes(promptId)) count += 1;
      }
      return count;
    }

    /** Ascending `order`, ties by the host's own array order (sort is stable). */
    function sortPrompts(prompts) {
      return prompts.slice().sort((a, b) => {
        const left = Number.isFinite(a?.order) ? a.order : 0;
        const right = Number.isFinite(b?.order) ? b.order : 0;
        return left - right;
      });
    }

    /**
     * One prompt out of a host response, by id.
     *
     * Used to confirm a write actually landed the field it was meant to: the
     * response body is the host's committed list, so it is the only honest
     * evidence that a field is supported at all.
     *
     * @param {unknown} prompts
     * @param {string} id
     * @returns {any | undefined}
     */
    function findPrompt(prompts, id) {
      if (!Array.isArray(prompts)) return undefined;
      for (const prompt of prompts) {
        if (prompt !== null && typeof prompt === 'object' && prompt.id === id) return prompt;
      }
      return undefined;
    }

    /** A switch: `role="switch"` + `aria-checked`, native button semantics. */
    function Toggle(props) {
      const attributes = {
        type: 'button',
        role: 'switch',
        'aria-checked': props.checked === true,
        className: 'dsp-switch',
        onClick: props.onClick,
      };
      // `aria-disabled`, not `disabled`: the greyed "pin" switch still has to
      // receive the click that explains why it cannot be used.
      if (props.disabled === true) attributes['aria-disabled'] = 'true';
      return h(
        'button',
        attributes,
        h(
          'span',
          { className: 'dsp-switch-track', 'aria-hidden': 'true' },
          h('span', { className: 'dsp-switch-knob' }),
        ),
        h('span', { className: 'dsp-switch-label' }, props.label),
      );
    }

    /**
     * The one place an error becomes screen text.
     *
     * Which codes get localized, and why, is not uniform:
     *
     * - `http` is the exception: the detail is the host's own message, printed
     *   verbatim because the host is the only thing that knows what went wrong
     *   ("只接受来自本机回环地址的请求" is genuinely useful to read).
     * - `network`, `protocol`, `conflict` and `corrupt` are all detected on this
     *   side or come back as host-side Chinese, so this file's own dictionary
     *   supplies the words — otherwise an English page would show Chinese, and
     *   the technical strings (`'response is not a JSON object'`) would reach a
     *   screen.
     *
     * @param {(key: string) => string} t
     * @param {{ code?: string, message?: string } | null} error
     * @returns {string}
     */
    function errorDetail(t, error) {
      const code = error?.code;
      if (code === 'network') return t('error.network');
      if (code === 'protocol') return t('error.protocol');
      // Raised by this file's own `assertWritable`, so the message is technical
      // and must never reach a screen verbatim.
      if (code === 'corrupt') return t('error.corrupt');
      // The host's 409 message is host-side Chinese; localize the situation.
      if (code === 'conflict') return t('error.conflict');
      // Raised when a write came back without the field it set: this page is
      // newer than the host serving it.
      if (code === 'unsupported') return t('error.kind');
      return String(error?.message ?? '');
    }

    /**
     * Inline error area: a localized prefix plus the detail.
     */
    function InlineError(props) {
      const { t, error } = props;
      return h(
        'div',
        { className: 'dsp-error', role: 'alert' },
        h('span', { className: 'dsp-error-prefix' }, t(props.prefixKey)),
        h('span', { className: 'dsp-error-message' }, errorDetail(t, error)),
        typeof props.onRetry === 'function'
          ? h('button', { type: 'button', className: 'dsp-retry', onClick: props.onRetry }, t('retry'))
          : null,
      );
    }

    /**
     * The `pinned ⇒ enabled` precondition dialog.
     *
     * Rendered INSIDE the card tree (no portal, nothing appended to `body`).
     * Escape is captured and stopped here so it closes this dialog and does not
     * also close the settings panel; opening focuses the primary button.
     */
    function PinDialog(props) {
      const { t } = props;
      const ids = React.useMemo(() => {
        dialogSequence += 1;
        return {
          title: 'dsp-pin-dialog-title-' + dialogSequence,
          body: 'dsp-pin-dialog-body-' + dialogSequence,
        };
      }, []);
      const primaryRef = React.useRef(null);
      const cancelRef = React.useRef(props.onCancel);
      React.useEffect(() => {
        cancelRef.current = props.onCancel;
      });
      React.useEffect(() => {
        if (primaryRef.current !== null) primaryRef.current.focus();
        function onKeyDown(event) {
          if (event.key !== 'Escape' && event.key !== 'Esc') return;
          event.preventDefault();
          event.stopPropagation();
          cancelRef.current();
        }
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
      }, []);
      function onBackdropMouseDown(event) {
        if (event.target === event.currentTarget) props.onCancel();
      }
      return h(
        'div',
        { className: 'dsp-overlay', onMouseDown: onBackdropMouseDown },
        h(
          'div',
          {
            className: 'dsp-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': ids.title,
            'aria-describedby': ids.body,
          },
          h('div', { className: 'dsp-dialog-title', id: ids.title }, t('dialog.title')),
          h('p', { className: 'dsp-dialog-body', id: ids.body }, t('dialog.pinnedNeedsEnabled')),
          h(
            'div',
            { className: 'dsp-dialog-actions' },
            h(
              'button',
              { type: 'button', className: 'dsp-button', onClick: props.onCancel },
              t('dialog.cancel'),
            ),
            h(
              'button',
              {
                type: 'button',
                ref: primaryRef,
                className: 'dsp-button dsp-button-primary',
                onClick: props.onConfirm,
              },
              t('dialog.confirm'),
            ),
          ),
        ),
      );
    }

    /** Monotonic id source for dialog label/description pairs. */
    let dialogSequence = 0;

    /**
     * One prompt card.
     *
     * Local `draft` is the source of truth for the two text fields: a failed
     * write must never cost the user what they typed, so nothing here is ever
     * re-seeded from the store. Switches, by contrast, read the store directly —
     * one write, one render, no optimistic state to get out of sync.
     */
    function PromptCard(props) {
      const { prompt, t, position, total } = props;
      const [draft, setDraft] = React.useState({ title: prompt.title, text: prompt.text });
      const [error, setError] = React.useState(null);
      const [notice, setNotice] = React.useState(null);
      const [dialogOpen, setDialogOpen] = React.useState(false);

      const idRef = React.useRef(prompt.id);
      /** Last values this card has successfully persisted (see `saveDraft`). */
      const saved = React.useRef({ title: prompt.title, text: prompt.text });
      /**
       * Every write this card has on the wire, as settled-never-rejects
       * promises.
       *
       * A Set, not a single slot: two overlapping saves (or a save plus a
       * switch click) each have to stay tracked, so a delete is ordered AFTER
       * all of them. The host rejects an upsert naming an unknown id
       * (`UnknownPromptError` -> 409, see `lib/host/store.js`), so a late save
       * can no longer resurrect the prompt — but it would still fail *after* the
       * delete succeeded and paint an error onto a card that is gone. Waiting for
       * them keeps the wire order honest. Entries remove themselves once settled,
       * so the Set cannot grow without bound.
       */
      const inFlight = React.useRef(new Set());
      /** Set right before a delete, so the unmount flush cannot resurrect it. */
      const discarded = React.useRef(false);
      const saveTimer = React.useRef(undefined);
      const noticeTimer = React.useRef(undefined);
      const pending = React.useRef(null);
      const titleRef = React.useRef(null);
      const textRef = React.useRef(null);

      /**
       * Register one write so a later delete can wait for it.
       *
       * @param {Promise<unknown>} write a store call that may reject
       * @returns {Promise<void>} settles either way, never rejects
       */
      function track(write) {
        const settled = write.then(
          () => {},
          () => {},
        );
        inFlight.current.add(settled);
        void settled.then(() => {
          inFlight.current.delete(settled);
        });
        return settled;
      }

      React.useEffect(() => {
        if (props.autoFocusTitle !== true || titleRef.current === null) return;
        titleRef.current.focus();
        // Told once: leaving it set would re-focus this card on every remount.
        props.onAutoFocused?.();
      }, [props.autoFocusTitle]);

      // Start at 72px, grow with the content, scroll past 240px.
      React.useEffect(() => {
        const element = textRef.current;
        if (element === null) return;
        element.style.height = 'auto';
        element.style.height = Math.min(element.scrollHeight, TEXTAREA_MAX_HEIGHT) + 'px';
      }, [draft.text]);

      // The 400ms window must not swallow the last keystroke when the panel is
      // closed. Nothing is rendered after unmount, so a failure here is silent —
      // the alternative (dropping the edit) is strictly worse.
      React.useEffect(
        () => () => {
          if (saveTimer.current !== undefined) {
            window.clearTimeout(saveTimer.current);
            saveTimer.current = undefined;
          }
          if (noticeTimer.current !== undefined) {
            window.clearTimeout(noticeTimer.current);
            noticeTimer.current = undefined;
          }
          const payload = pending.current;
          pending.current = null;
          if (payload === null || discarded.current) return;
          store
            .upsert({ id: idRef.current, title: payload.title, text: payload.text })
            .catch(() => {});
        },
        [],
      );

      function clearSaveTimer() {
        if (saveTimer.current !== undefined) {
          window.clearTimeout(saveTimer.current);
          saveTimer.current = undefined;
        }
      }

      /**
       * Write the two text fields.
       *
       * The no-op check compares against `saved`, the last value this card
       * successfully wrote, NOT against the `prompt` prop. The prop lags behind
       * (a refresh only lands after the write), so comparing against it could
       * throw away a legitimate edit whose previous save had not been reflected
       * yet.
       *
       * @param {{ title: string, text: string }} payload
       */
      async function saveDraft(payload) {
        // A deleted card must never write again. This is not just the "don't
        // re-create what the user removed" rule: clicking Remove fires a blur
        // first, and that blur flushes this very function, so the guard is what
        // stops the click itself from scheduling the resurrect.
        if (discarded.current) return;
        if (payload.title === saved.current.title && payload.text === saved.current.text) return;
        const write = store.upsert({ id: idRef.current, title: payload.title, text: payload.text });
        track(write);
        try {
          await write;
          saved.current = { title: payload.title, text: payload.text };
          setError(null);
        } catch (caught) {
          // The card may already be gone (see `handleRemove`), in which case
          // there is no error area left to report into.
          if (discarded.current) return;
          setError({ prefixKey: 'error.save', ...serializeError(caught) });
        }
      }

      function schedule(payload) {
        pending.current = payload;
        clearSaveTimer();
        saveTimer.current = window.setTimeout(() => {
          saveTimer.current = undefined;
          const next = pending.current;
          pending.current = null;
          if (next !== null) void saveDraft(next);
        }, SAVE_DEBOUNCE_MS);
      }

      function flushPending() {
        clearSaveTimer();
        const next = pending.current;
        pending.current = null;
        if (next !== null) void saveDraft(next);
      }

      function showNotice(message) {
        setNotice(message);
        if (noticeTimer.current !== undefined) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => {
          noticeTimer.current = undefined;
          setNotice(null);
        }, NOTICE_MS);
      }

      /**
       * Patch one prompt through the store.
       *
       * `pinned ⇒ enabled` is enforced on the host too, but the UI states the
       * intent explicitly: turning Active off sends `pinned: false` in the same
       * write rather than relying on the server to demote it.
       *
       * A switch click is a write like any other, so it gets the same two
       * protections the text saves have. A click landing between
       * `store.remove()` and the unmount that follows its refresh would POST an
       * upsert for a just-deleted id; the host now rejects that with a 409
       * instead of treating it as a CREATE, and this guard keeps the request
       * from being sent at all.
       *
       * @returns {Promise<boolean>} whether the host accepted the write
       */
      async function patchPrompt(patch, failureKey) {
        if (discarded.current) return false;
        const write = store.upsert({ id: idRef.current, ...patch });
        track(write);
        try {
          await write;
          if (discarded.current) return false;
          setError(null);
          return true;
        } catch (caught) {
          // Nothing left to report into once the card is discarded.
          if (discarded.current) return false;
          setError({ prefixKey: failureKey, ...serializeError(caught) });
          return false;
        }
      }

      async function handleToggleEnabled() {
        const next = !prompt.enabled;
        const clearsPin = !next && prompt.pinned === true;
        setNotice(null);
        const applied = await patchPrompt(
          clearsPin ? { enabled: false, pinned: false } : { enabled: next },
          'error.save',
        );
        if (applied && clearsPin) showNotice(t('notice.pinCleared'));
      }

      function handleTogglePinned() {
        // The invariant check lives here: a greyed switch does not toggle, it
        // explains itself and offers the one action that can satisfy it.
        if (prompt.enabled !== true) {
          setDialogOpen(true);
          return;
        }
        void patchPrompt({ pinned: !prompt.pinned }, 'error.save');
      }

      /**
       * Switch this prompt between a system prompt and a quick prompt.
       *
       * The kind only changes what a click does (tick vs insert) and which group
       * the row belongs to; `pinned` survives the crossing, because an
       * always-visible entry point is just as useful for one kind as the other.
       *
       * **Verified, not assumed.** The response is the host's committed prompt
       * list, so the click only counts as applied when that list actually carries
       * the new kind. A host that does not know the field silently drops it, and
       * without this check the control would look broken-in-the-quiet-way: the
       * radio would snap back on the next read with no explanation.
       */
      async function handleToggleKind() {
        const nextKind = prompt.kind === 'quick' ? 'system' : 'quick';
        setNotice(null);
        if (discarded.current) return;
        const write = store.upsert({ id: idRef.current, kind: nextKind });
        track(write);
        try {
          const payload = await write;
          if (discarded.current) return;
          setError(null);
          const saved = findPrompt(payload?.prompts, idRef.current);
          if (saved === undefined || saved.kind !== nextKind) {
            // The write was accepted but the field did not survive: this page is
            // newer than the host that serves it.
            setError({ prefixKey: 'error.kind', ...{ code: 'unsupported' } });
          }
        } catch (caught) {
          if (discarded.current) return;
          setError({ prefixKey: 'error.save', ...serializeError(caught) });
        }
      }

      /**
       * Move this card one slot earlier or later.
       *
       * Goes through `track` like every other write so a delete ordered after it
       * cannot interleave.
       *
       * @param {-1 | 1} direction
       */
      async function handleMove(direction) {
        if (discarded.current) return;
        if (typeof props.onMove !== 'function') return;
        const write = Promise.resolve(props.onMove(direction));
        track(write);
        try {
          await write;
          if (discarded.current) return;
          setError(null);
        } catch (caught) {
          if (discarded.current) return;
          setError({ prefixKey: 'error.save', ...serializeError(caught) });
        }
      }

      function handleConfirmDialog() {
        setDialogOpen(false);
        void patchPrompt({ enabled: true, pinned: true }, 'error.save');
      }

      async function handleRemove() {
        // Marked first, so a blur that has not run yet cannot enqueue a save.
        discarded.current = true;
        clearSaveTimer();
        pending.current = null;
        setNotice(null);
        // Snapshot the set, then wait for ALL of it: a save and a switch click
        // can both be on the wire, and either landing after the delete would
        // resurrect the prompt (see `inFlight`).
        const queued = Promise.all([...inFlight.current]);
        inFlight.current.clear();
        try {
          // Ordered AFTER every write already on the wire: the host creates a
          // prompt for an unknown id, so a write landing post-delete would
          // resurrect it.
          await queued;
          if (discarded.current !== true) return;
          await store.remove(idRef.current);
        } catch (caught) {
          // The card is still here, so editing continues to make sense.
          discarded.current = false;
          setError({ prefixKey: 'error.remove', ...serializeError(caught) });
        }
      }

      const titleId = 'dsp-title-' + prompt.id;
      const textId = 'dsp-text-' + prompt.id;
      // One radio group per card: a shared name would let one card's selection
      // clear another's.
      const kindName = 'dsp-kind-' + prompt.id;
      const tickCount = Number.isFinite(props.tickCount) ? props.tickCount : 0;

      const children = [];
      if (error !== null) {
        children.push(h(InlineError, { key: 'error', t, prefixKey: error.prefixKey, error }));
      }
      if (notice !== null) {
        children.push(h('div', { key: 'notice', className: 'dsp-notice', role: 'status' }, notice));
      }
      children.push(
        h(
          'div',
          { key: 'kind', className: 'dsp-field' },
          h('span', { className: 'dsp-field-label' }, t('label.kind')),
          h(
            'div',
            { className: 'dsp-field-control' },
            h(
              'div',
              { className: 'dsp-radio-group', role: 'radiogroup', 'aria-label': t('label.kind') },
              // Native radios sharing a per-card `name`: the browser owns the
              // mutex, arrow keys move between them, and the selected one is the
              // single tab stop. A pair of buttons could never do all three.
              h(
                'label',
                { className: 'dsp-radio' },
                h('input', {
                  type: 'radio',
                  className: 'dsp-radio-input',
                  name: kindName,
                  value: 'system',
                  checked: prompt.kind !== 'quick',
                  onChange: () => {
                    if (prompt.kind === 'quick') void handleToggleKind();
                  },
                }),
                h('span', { className: 'dsp-radio-label' }, t('kind.system')),
              ),
              h(
                'label',
                { className: 'dsp-radio' },
                h('input', {
                  type: 'radio',
                  className: 'dsp-radio-input',
                  name: kindName,
                  value: 'quick',
                  checked: prompt.kind === 'quick',
                  onChange: () => {
                    if (prompt.kind !== 'quick') void handleToggleKind();
                  },
                }),
                h('span', { className: 'dsp-radio-label' }, t('kind.quick')),
              ),
            ),
            h(
              'span',
              { className: 'dsp-kind-hint' },
              prompt.kind === 'quick' ? t('kind.quickHint') : t('kind.systemHint'),
            ),
          ),
        ),
      );
      children.push(
        h(
          'div',
          { key: 'title', className: 'dsp-field' },
          h('label', { className: 'dsp-field-label', htmlFor: titleId }, t('label.title')),
          h(
            'div',
            { className: 'dsp-field-control' },
            h('input', {
              id: titleId,
              ref: titleRef,
              className: 'dsp-input',
              type: 'text',
              value: draft.title,
              placeholder: t('label.titlePlaceholder'),
              onChange: event => {
                const next = { title: event.target.value, text: draft.text };
                setDraft(next);
                schedule(next);
              },
              onBlur: flushPending,
            }),
          ),
        ),
      );
      children.push(
        h(
          'div',
          { key: 'text', className: 'dsp-field' },
          h('label', { className: 'dsp-field-label', htmlFor: textId }, t('label.text')),
          h(
            'div',
            { className: 'dsp-field-control' },
            h('textarea', {
              id: textId,
              ref: textRef,
              className: 'dsp-textarea',
              value: draft.text,
              placeholder: t('label.textPlaceholder'),
              onChange: event => {
                const next = { title: draft.title, text: event.target.value };
                setDraft(next);
                schedule(next);
              },
              onBlur: flushPending,
            }),
          ),
        ),
      );
      children.push(
        h(
          'div',
          { key: 'switches', className: 'dsp-switch-row' },
          h(
            'div',
            { className: 'dsp-switch-cell' },
            h(Toggle, {
              checked: prompt.enabled === true,
              label: prompt.enabled === true ? t('switch.enabled') : t('switch.disabled'),
              onClick: () => void handleToggleEnabled(),
            }),
            // A pre-disable warning, not a status line: it only means anything
            // while the prompt is still on, which is exactly when turning it off
            // is the next thing the user might do.
            prompt.enabled === true && tickCount > 0
              ? h('span', { className: 'dsp-ticks-hint' }, t('hint.ticks', { count: tickCount }))
              : null,
          ),
          h(
            'div',
            { className: 'dsp-switch-cell' },
            h(Toggle, {
              checked: prompt.pinned === true,
              disabled: prompt.enabled !== true,
              label: t('switch.pinned'),
              onClick: handleTogglePinned,
            }),
          ),
          h(
            'div',
            { key: 'order', className: 'dsp-order' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsp-order-button',
                'aria-label': t('order.up'),
                title: t('order.up'),
                'aria-disabled': position > 0 ? undefined : 'true',
                onClick: () => {
                  if (position > 0) void handleMove(-1);
                },
              },
              '↑',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsp-order-button',
                'aria-label': t('order.down'),
                title: t('order.down'),
                'aria-disabled': position < total - 1 ? undefined : 'true',
                onClick: () => {
                  if (position < total - 1) void handleMove(1);
                },
              },
              '↓',
            ),
          ),
          h(
            'button',
            {
              key: 'remove',
              type: 'button',
              className: 'dsp-remove',
              onClick: () => void handleRemove(),
            },
            t('remove'),
          ),
        ),
      );
      if (dialogOpen) {
        children.push(
          h(PinDialog, {
            key: 'dialog',
            t,
            onCancel: () => setDialogOpen(false),
            onConfirm: handleConfirmDialog,
          }),
        );
      }

      return h('div', { className: 'dsp-card' }, children);
    }

    /**
     * The settings page (`settings.section`, id `session-prompts`).
     *
     * The shell owns only the panel chrome that is genuinely shared: the close
     * button and a panel-level title seat. That title seat (`settings.header`)
     * is a SINGLE seat, and the General section already occupies it, so it does
     * NOT carry this page's name. Every sibling section therefore renders its
     * own `h2` from its `nav` string, and so does this one — otherwise the page
     * would appear with no heading at all.
     */
    function SettingsPage(props) {
      const t = typeof props?.t === 'function' ? props.t : fallbackT;
      const snapshot = useSnapshot(store);
      const [addError, setAddError] = React.useState(null);
      const [focusId, setFocusId] = React.useState(null);

      // The file may be mounted long after `apply` ran (and the user may have
      // changed things on the other surface since), so every mount re-reads.
      React.useEffect(() => {
        void store.refresh();
      }, []);

      const prompts = React.useMemo(() => sortPrompts(snapshot.data.prompts), [snapshot.data.prompts]);

      /**
       * Whether the host reported an unparsable state file.
       *
       * While true the page renders an error state instead of the list and the
       * empty state — most importantly, instead of the "add" button. The store
       * refuses the write as well; not offering it is what stops the user from
       * trying, and what makes a corrupt file visible rather than looking like
       * an account that was simply emptied.
       */
      const corrupt = snapshot.data.corrupt === true;

      async function handleAdd() {
        setAddError(null);
        const before = new Set(snapshot.data.prompts.map(prompt => prompt.id));
        try {
          const payload = await store.upsert({});
          const created = (Array.isArray(payload?.prompts) ? payload.prompts : []).find(
            prompt => !before.has(prompt.id),
          );
          if (created !== undefined) setFocusId(created.id);
        } catch (caught) {
          setAddError(serializeError(caught));
        }
      }

      function addButton(key) {
        return h(
          'button',
          { key, type: 'button', className: 'dsp-add', onClick: () => void handleAdd() },
          // The glyph is decorative: the accessible name stays the copy-table
          // label, which is also what the empty state and the list both show.
          h('span', { className: 'dsp-add-glyph', 'aria-hidden': 'true' }, '+'),
          t('add'),
        );
      }

      const children = [
        // The page-own heading (the copy table's 页面标题). The nav row label
        // above it comes from the slot registration, but nothing in the shell
        // prints this page's name inside the panel — see the comment on
        // `SettingsPage`.
        h('h2', { key: 'title', className: 'dsp-title' }, t('nav')),
        h('p', { key: 'description', className: 'dsp-description' }, t('description')),
      ];

      if (snapshot.error !== null) {
        children.push(
          h(InlineError, {
            key: 'load-error',
            t,
            prefixKey: 'error.load',
            error: snapshot.error,
            // `reloadState`, not `refresh`: the host's snapshot may itself be the
            // record of a failed read (unreadable file, wrong permissions), so
            // only a re-read from disk can answer differently. A plain `/state`
            // read would answer 500 again forever and this button would be a lie.
            onRetry: () => void store.reloadState(),
          }),
        );
      }
      if (addError !== null) {
        children.push(
          h(InlineError, { key: 'add-error', t, prefixKey: 'error.save', error: addError }),
        );
      }

      if (snapshot.loaded !== true) {
        // No list, no empty state and above all no "add": a state file that
        // could not be read must not be overwritten by a cheerful new prompt.
        if (snapshot.status === 'loading') {
          children.push(h('p', { key: 'loading', className: 'dsp-status' }, t('status.loading')));
        }
      } else if (corrupt) {
        // The read succeeded but the file on disk could not be parsed. Saying
        // "no prompts yet" here would be a lie that invites a destructive save,
        // so this branch replaces the empty state AND the list entirely.
        //
        // Retry here asks the host to RE-READ the file (`reloadState`), which is
        // the only way this page can recover from a corrupt file without a
        // restart: repairing the JSON on disk and pressing it now genuinely
        // works, and the host still refuses writes if the bytes are still bad.
        children.push(
          h(InlineError, {
            key: 'corrupt',
            t,
            prefixKey: 'error.load',
            error: { code: 'corrupt', message: '' },
            onRetry: () => void store.reloadState(),
          }),
        );
      } else if (prompts.length === 0) {
        children.push(
          h(
            'div',
            { key: 'empty', className: 'dsp-empty' },
            h('div', { className: 'dsp-empty-title' }, t('empty.title')),
            h('div', { className: 'dsp-empty-hint' }, t('empty.hint')),
            addButton('empty-add'),
          ),
        );
      } else {
        children.push(
          h(
            'div',
            { key: 'list', className: 'dsp-list' },
            prompts.map((prompt, index) =>
              h(PromptCard, {
                key: prompt.id,
                t,
                prompt,
                tickCount: countSessionsTicking(snapshot.data.ticks, prompt.id),
                autoFocusTitle: focusId === prompt.id,
                onAutoFocused: () => setFocusId(null),
                // Reordering is one global order across both kinds, so the strip
                // can interleave a quick prompt with system prompts.
                position: index,
                total: prompts.length,
                onMove: direction => store.move(prompt.id, direction),
              }),
            ),
          ),
        );
        children.push(addButton('add'));
      }

      return h('div', { className: 'dsp-page' }, children);
    }

    // =========================================================================
    // 6. Styles — ONE `<style>` for BOTH surfaces: `--dsw-alias-*` for colour,
    //    the host's `--dsh-composer-*` layout variables for width alignment
    // =========================================================================

    const STYLE_ID = 'dsh-session-prompts-styles';

    const STYLES = `
/* The settings nav glyph: the shell owns the button and its selected colour, so
   this only has to not fight it — inherit the current colour, never scale
   sharply, and stay hidden from assistive tech (the nav row has a label). */
.dsp-section-icon {
  display: block;
  flex: none;
  color: inherit;
}
.dsp-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--dsw-alias-label-primary);
}
/* The page's own heading, matching the sibling sections' h2 scale. */
.dsp-title {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
}
.dsp-description {
  margin: 0 0 4px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}
.dsp-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dsp-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-sizing: border-box;
  padding: 16px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsp-field {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.dsp-field-label {
  flex: none;
  min-width: 40px;
  padding-top: 6px;
  text-align: right;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}
.dsp-field-control {
  flex: 1 1 auto;
  min-width: 0;
}
.dsp-input,
.dsp-textarea {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
}
.dsp-textarea {
  min-height: 72px;
  max-height: 240px;
  overflow-y: auto;
  resize: none;
}
.dsp-input:focus,
.dsp-textarea:focus {
  border-color: var(--dsw-alias-brand-primary);
  outline: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent);
  outline-offset: 0;
}
.dsp-input::placeholder,
.dsp-textarea::placeholder {
  color: var(--dsw-alias-label-tertiary);
}
.dsp-switch-row {
  display: flex;
  align-items: flex-start;
  gap: 24px;
}
/* Kind selector: two native radios in a group, so the browser owns the mutex,
   arrow keys move between them, and only the checked one is a tab stop. */
.dsp-radio-group {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 28px;
}
.dsp-radio {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.dsp-radio-input {
  flex: none;
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--dsw-alias-button-primary-fill);
  cursor: pointer;
}
.dsp-radio-label {
  white-space: nowrap;
}
.dsp-kind-hint {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
}
/* A quick-prompt row is a button, so it must not inherit the label's look. */
.dsp-dock-quick-row {
  border: 0;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dsp-dock-quick-row:hover {
  background: var(--dsw-alias-bg-layer-2);
}
.dsp-switch-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.dsp-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.dsp-switch:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dsp-switch-track {
  position: relative;
  flex: none;
  width: 32px;
  height: 18px;
  border-radius: 9px;
  background: var(--dsw-alias-border-l3);
  transition: background-color 160ms ease;
}
.dsp-switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--dsw-alias-label-primary);
  transition: transform 160ms ease, background-color 160ms ease;
}
.dsp-switch[aria-checked="true"] .dsp-switch-track {
  background: var(--dsw-alias-button-primary-fill);
}
.dsp-switch[aria-checked="true"] .dsp-switch-knob {
  background: var(--dsw-alias-label-primary-foreground);
  transform: translateX(14px);
}
.dsp-switch[aria-disabled="true"] {
  opacity: 0.4;
  cursor: default;
}
.dsp-ticks-hint {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 16px;
}
/* ---- the composer dock ------------------------------------------------- */
/* The dock's own width contract: the shipped entries (todo, goal, queue) all
   subtract the composer's clearances so the strip lines up with the input card.
   Nothing here paints a background of its own — a row only gets one on hover. */
.dsp-dock {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));
  max-width: calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));
  margin: 0 auto;
  color: var(--dsw-alias-label-primary);
}
/* The single horizontal row of groups; each group stacks its popup above its
   own button inside .dsp-dock-group-wrap. */
.dsp-dock-strip {
  box-sizing: border-box;
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}
/* A group is a column: [popup][button]. Aligning to the bottom keeps every
   button on the same baseline even when one group's popup is open. */
.dsp-dock-group-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
/* The popup list, drawn as a bordered card so it reads as a surface floating
   above the strip rather than loose rows of text. It stays in normal flow, so it
   pushes the strip down instead of covering the composer. */
.dsp-dock-popover {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  max-height: 260px;
  margin-bottom: 4px;
  padding: 4px;
  overflow-y: auto;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
}
/* Rows inside the list line up with the group glyph, one indent in. */
.dsp-dock-popover .dsp-dock-row {
  padding-left: 8px;
  width: 100%;
  box-sizing: border-box;
}
.dsp-dock-item {
  display: flex;
  flex-direction: column;
}
/* Rows inside the strip size to their title and share the line. */
.dsp-dock-strip .dsp-dock-item {
  min-width: 0;
  max-width: 220px;
}
.dsp-dock-row {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  min-width: 0;
  padding: 0 8px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 28px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.dsp-dock-row:hover {
  background: var(--dsw-alias-bg-layer-2);
}
.dsp-dock-check {
  flex: none;
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--dsw-alias-button-primary-fill);
  cursor: pointer;
}
.dsp-dock-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  color: var(--dsw-alias-label-primary);
}
/* Sized by its content, so pinned prompts can share the line after it. */
.dsp-dock-group {
  flex: 0 0 auto;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  min-width: 0;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: none;
  font: inherit;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  text-align: left;
}
.dsp-dock-group:hover,
.dsp-dock-group[aria-expanded="true"] {
  color: var(--dsw-alias-label-primary);
}
.dsp-dock-group:hover {
  background: var(--dsw-alias-bg-layer-2);
}
.dsp-dock-group:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dsp-dock-glyph {
  flex: none;
  display: block;
  color: inherit;
}
.dsp-dock-group-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 28px;
}
.dsp-dock-chevron {
  flex: none;
  font-size: 12px;
  line-height: 28px;
  color: var(--dsw-alias-label-tertiary);
}
/* Inline failure for ONE row, right under it; the row itself is restored. */
.dsp-dock-error {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 8px 4px 24px;
  font-size: 12px;
  line-height: 16px;
}
.dsp-dock-error-prefix {
  color: var(--dsw-alias-state-error-primary);
  font-weight: 600;
}
.dsp-dock-error-detail {
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
/* Reorder controls: a compact up/down pair before Remove. The auto margin
   lives here so the pair and Remove sit together at the right edge. */
.dsp-order {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}
.dsp-order-button {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 24px;
  cursor: pointer;
}
.dsp-order-button:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
}
.dsp-order-button:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dsp-order-button[aria-disabled="true"] {
  color: var(--dsw-alias-label-tertiary);
  cursor: default;
  background: none;
}
.dsp-remove {
  margin-left: 8px;
  padding: 4px 8px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.dsp-remove:hover {
  color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsp-remove:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dsp-add {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--dsw-alias-brand-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.dsp-add-glyph {
  font-size: 15px;
  line-height: 20px;
}
.dsp-add:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsp-add:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dsp-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 8px 0 4px;
}
.dsp-empty-title {
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
  font-weight: 600;
}
.dsp-empty-hint {
  margin-bottom: 2px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}
.dsp-error {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
}
.dsp-error-prefix {
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
}
.dsp-error-message {
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 18px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dsp-notice {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.dsp-status {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
}
.dsp-retry {
  padding: 0;
  border: 0;
  background: none;
  color: var(--dsw-alias-brand-primary);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
  cursor: pointer;
}
.dsp-retry:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dsp-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--dsw-alias-bg-mask-1);
}
.dsp-dialog {
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-sizing: border-box;
  width: min(420px, 100%);
  padding: 20px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}
.dsp-dialog-title {
  font-size: 14px;
  line-height: 22px;
  font-weight: 600;
}
.dsp-dialog-body {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}
.dsp-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.dsp-button {
  padding: 5px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.dsp-button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsp-button:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}
.dsp-button-primary {
  border-color: var(--dsw-alias-button-primary-fill);
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
@media (prefers-reduced-motion: reduce) {
  .dsp-switch-track,
  .dsp-switch-knob {
    transition: none;
  }
}
`;

    /**
     * Create and own the shared `<style>` element.
     *
     * There is exactly one, and BOTH surfaces read it.
     *
     * @returns {() => void} the disposer that removes it again
     */
    function injectStyles() {
      if (typeof document === 'undefined' || document === null) return () => {};
      const existing = document.getElementById(STYLE_ID);
      if (existing !== null && existing !== undefined) existing.remove();
      const container = document.head ?? document.body;
      if (container === null || container === undefined) return () => {};
      const element = document.createElement('style');
      element.id = STYLE_ID;
      element.textContent = STYLES;
      container.appendChild(element);
      return () => {
        try {
          element.remove();
        } catch {
          /* already gone */
        }
      };
    }

    // =========================================================================
    // 7. apply
    // =========================================================================

    /** `ctx.get` never throws for an absent service; `ctx.locale` may not exist. */
    function readLocale(ctx) {
      if (ctx === null || typeof ctx !== 'object') return undefined;
      try {
        if (typeof ctx.get === 'function') {
          const viaGet = ctx.get('locale');
          if (viaGet !== undefined && viaGet !== null) return viaGet;
        }
      } catch {
        /* fall through to the property */
      }
      try {
        if (ctx.locale !== undefined && ctx.locale !== null) return ctx.locale;
      } catch {
        /* no locale service at all */
      }
      return undefined;
    }

    /** `locale`, because every string on this page goes through it. */
    exports.inject = ['slots', 'locale'];

    exports.apply = function apply(ctx) {
      try {
        const locale = readLocale(ctx);
        const t = createTranslator(locale);

        // Dictionaries first: the nav label is read from this namespace.
        let unwatchDictionaries = () => {};
        if (locale !== undefined && typeof locale.register === 'function') {
          try {
            const disposer = locale.register(DICT_NS, { zh: DICT.zh, en: DICT.en });
            if (typeof disposer === 'function') unwatchDictionaries = disposer;
          } catch (error) {
            // A namespace already taken (a reload) must not cost the page: the
            // inline table answers every key either way.
            console.error('dsh-session-prompts: 注册文案字典失败，改用内置文案', error);
          }
        }
        ctx.effect(() => () => {
          try {
            unwatchDictionaries();
          } catch {
            /* nothing left to release */
          }
        });

        // Styles are an effect, so unloading the plugin leaves no residue.
        // ONE stylesheet, both surfaces: the settings page and the composer
        // dock share it (see the header of section 6).
        ctx.effect(() => injectStyles(), 'dsh-session-prompts: styles (settings page + composer dock)');

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'session-prompts',
              order: 5,
              label: () => t('nav'),
              locale: DICT_NS,
              inject: () => ({ t }),
            },
            SettingsPage,
          ),
        );

        // The nav-row glyph. The shell renders this list with `only: row.id`, so
        // the id must match the section's own id exactly or it never appears.
        ctx.slots.inject('settings.section.icon', () =>
          ctx.slots.register(
            { name: 'settings.section.icon', id: 'session-prompts' },
            SectionIcon,
          ),
        );

        // The composer dock. `order: 30` puts it after the shipped todo (0),
        // goal (10) and queue (20) entries and before anything unnumbered.
        //
        // NO `locale` here, deliberately. Declaring one makes the slot host
        // build a `t` seat for this entry (`kit.t = localeSeat(face, ns)`), and
        // that is the ONLY thing the option does — it buys no `label` (this
        // slot has no nav row) and no other shared prop. That seat is exactly
        // the trap this entry must avoid: it is `face.bind(ns)`, which answers
        // with the bare key whenever the namespace has no dictionary — which is
        // precisely the state left behind when `locale.register` threw above
        // because the namespace was already taken by a reload. It would also
        // make the host throw `SlotAssemblyError` in a composition with no
        // locale face at all.
        //
        // So `inject` supplies THIS file's `t`: the one whose fallback chain is
        // framework-bind -> inline DICT (`createTranslator`). `renderEntry`
        // spreads `{...kit, ...injected, ...}`, so an injected prop wins over
        // the kit seat — and with no `locale` declared there is no seat to
        // fight, which makes the translation independent of that spread order
        // rather than merely relying on it.
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.dock',
              id: 'session-prompts',
              order: 30,
              inject: () => ({ t }),
            },
            Dock,
          ),
        );

        // Warm the shared cache once so the first paint of either surface has
        // data instead of a spinner.
        void store.refresh();
      } catch (error) {
        // A broken settings page must not take down the plugin's host half or
        // the rest of the client: surface it and stop.
        console.error('dsh-session-prompts: 配置页注册失败', error);
      }
    };

    return module.exports;
  },
});
