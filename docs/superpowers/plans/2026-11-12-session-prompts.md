# 会话提示词插件 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个可安装的 DSH 插件：配置页维护一批系统提示词，在对话输入框上方按会话勾选注入。

**Architecture:** 宿主侧用一个按 agent 注册的系统提示词 section 承载注入（文本是函数，每次装配现算）；提示词与勾选状态存在插件自己的 JSON 里；三个 loopback 精确路由供浏览器读写；浏览器侧在两个插槽渲染配置页和勾选区。

**Tech Stack:** 纯 ESM JavaScript（无构建）、`node:test` 测试、DSH 插件包格式（`dsh.bundle.patch` + `dsh.client`）。

**Spec:** `docs/superpowers/specs/2026-11-12-session-prompts-design.md`

## Global Constraints

- **无构建步骤**：宿主侧是多文件 ESM；浏览器侧 `client.js` 必须是**单文件自包含**——模块加载器只支持自包含产物，`client.js` 不能同步 `require` 任何相对路径文件。
- **不导出 `Config`**：`@deepseek-ai/schemastery` 在本地目录安装时无法保证可解析，因此不声明配置 schema。section 的 `order` 固定为常量 `10150`。
- **section 必须 `interpolate: false`**，正文按字面处理。
- **每个 agent 的 section 注册必须幂等**（`SessionStartSource` 含 `'clear'` / `'compact'`，重复注册同名 section 抛错）。
- **不变式 `pinned ⇒ enabled`** 在写入层强制。
- **空数组 ≠ 缺失**：缺失沿 `parentSession` 继承；`[]` 表示明确一个都不要。
- **三个路由只接受 loopback**。
- 样式只用 `--dsw-alias-*` token，不 import 任何 `@deepseek-ai/dsh-client-*` 包。
- **本工作区不是 git 仓库**：每个任务以「跑测试通过」收尾，不做 commit。若用户之后初始化了仓库，再按需补提交。

## Review Focus

以下五类输入/故障是规格隐含但最容易咬人的，各自在属主任务里有测试：

1. **正文含 `{{`** —— 用户手写的正文出现花括号时，若开着插值会让该会话每次请求都失败。section 用 `interpolate: false`，Task 5 钉住。
2. **`parentSession` 成环** —— 继承向上查找必须有 visited 集合，否则死循环。Task 3。
3. **空正文** —— `enabled` 为真但 `text` 为空，不能贡献空段或多余分隔符。Task 3。
4. **手工改坏 JSON 产生 `pinned: true, enabled: false`** —— `sanitizeState` 必须把它修正成 `pinned: false`，否则状态矩阵出现非法行。Task 2。
5. **并发单条切换** —— 两个写入先后到达不能互相覆盖。Task 4。

## 文件结构

```
D:\ds_plugin\dsh-session-prompts\
  package.json            清单：exports / files / dsh.bundle / dsh.client
  cordis.patch.yml        插入一行插件条目
  index.js                宿主入口：apply(ctx)
  lib/host/store.js       JSON 状态：读写、原子落盘、增删改、勾选切换
  lib/host/render.js      勾选集合解析（含继承）与正文拼接
  lib/host/routes.js      三个精确路由
  lib/host/section.js     按 agent 幂等注册 section
  client.js               浏览器入口（单文件：配置页 + 勾选区 + 多语言）
  locale/en.json          meta.title / meta.description
  locale/zh.json          同上
  icon.svg                插件图标
  test/store.test.js
  test/render.test.js
  test/routes.test.js
  test/section.test.js
  README.md
```

---

### Task 1: 包骨架与可安装性

先让一个空插件能装上，后续任务才谈得上实测。

**Files:**
- Create: `dsh-session-prompts/package.json`
- Create: `dsh-session-prompts/cordis.patch.yml`
- Create: `dsh-session-prompts/index.js`
- Create: `dsh-session-prompts/client.js`
- Create: `dsh-session-prompts/locale/en.json`
- Create: `dsh-session-prompts/locale/zh.json`
- Create: `dsh-session-prompts/icon.svg`

**Interfaces:**
- Produces: 一个可被 `plugin_manager` 以目录方式安装的包；包名 `dsh-session-prompts`。

- [ ] **Step 1: 写 `package.json`**

`exports` 必须含 `"."`、`"./client"`、`"./locale/*.json"`、`"./icon"`；`files` 覆盖全部产物。

```json
{
  "name": "dsh-session-prompts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "client.js", "lib", "cordis.patch.yml", "locale/*.json", "icon.svg", "README.md"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": [
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-slots",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-locale"
      ]
    }
  }
}
```

- [ ] **Step 2: 写 `cordis.patch.yml`**

```yaml
- insert:
    - id: session-prompts
      name: 'dsh-session-prompts'
```

- [ ] **Step 3: 写占位 `index.js` 与 `client.js`**

`index.js` 导出 `export function apply() {}`。`client.js` 用
`window.__ModuleLoader__.load({ id: 'dsh-session-prompts', factory(require) { ... } })`，
factory 返回 `{ inject: ['slots'], apply(ctx) {} }`。两者都先留空，只保证结构成立。

- [ ] **Step 4: 写 locale 与图标**

`locale/zh.json`：

```json
{ "meta": { "title": "会话提示词", "description": "维护一组系统提示词，在对话输入框上方按会话勾选注入。" } }
```

`locale/en.json`：

```json
{ "meta": { "title": "Session prompts", "description": "Maintain system prompts and tick them above the composer, per session." } }
```

`icon.svg` 自己画一个原创图形（64×64 视口，圆角方形底 + 三条横线 + 一条勾），
不用模板里的蓝色圆形。

- [ ] **Step 5: 语法检查两个入口**

Run: `node --check dsh-session-prompts/index.js` 与 `node --check dsh-session-prompts/client.js`
Expected: 无输出（通过）。

- [ ] **Step 6: 安装到当前 profile**

用 `plugin_manager` 的 `install_bundle`，`target` 传包目录绝对路径
`D:\ds_plugin\dsh-session-prompts`。读返回的 `application` 与 `warnings`。

Expected: `application: applied`。若报依赖或清单问题，就地修好后重试。

- [ ] **Step 7: 确认插件行为空但已激活**

Run: 用 `cordis_inspect_query`（platform `client`，provider `Slots`，method `listSubTree`，`input: {"root": "settings.section"}`）
Expected: 返回的 `selected.occupants` 里暂时还没有 `session-prompts`（本任务只装骨架，不注册插槽）。

---

### Task 2: 状态存储

**Files:**
- Create: `dsh-session-prompts/lib/host/store.js`
- Test: `dsh-session-prompts/test/store.test.js`

**Interfaces:**
- Produces:
  - `emptyState() -> State`
  - `sanitizeState(raw: unknown) -> State`
  - `async loadState(filePath: string) -> State`
  - `async saveState(filePath: string, state: State) -> void`
  - `upsertPrompt(state: State, patch: object) -> State`
  - `deletePrompt(state: State, id: string) -> State`
  - `setTick(state: State, sessionId: string, promptId: string, on: boolean) -> State`
  - `countTicks(state: State, promptId: string) -> number`
  - 类型：`Prompt = { id, title, text, enabled, pinned, order }`，`State = { version, prompts: Prompt[], ticks: Record<string, string[]> }`

- [ ] **Step 1: 写失败的测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeState, upsertPrompt, deletePrompt, setTick, countTicks } from '../lib/host/store.js'

test('sanitize 丢掉畸形条目并补默认值', () => {
  const s = sanitizeState({ prompts: [{ id: 'a' }, null, { title: 'no id' }] })
  assert.equal(s.prompts.length, 1)
  assert.equal(s.prompts[0].id, 'a')
  assert.equal(s.prompts[0].enabled, false)
  assert.equal(s.prompts[0].pinned, false)
  assert.equal(s.prompts[0].text, '')
})

test('sanitize 强制 pinned => enabled', () => {
  const s = sanitizeState({ prompts: [{ id: 'a', enabled: false, pinned: true }] })
  assert.equal(s.prompts[0].pinned, false)
})

test('sanitize 容忍非对象与非数组', () => {
  assert.deepEqual(sanitizeState(null).prompts, [])
  assert.deepEqual(sanitizeState({ prompts: 'x', ticks: 5 }).ticks, {})
})

test('upsert 新增与更新，并拒绝 pinned 而不 enabled', () => {
  let s = emptyState()
  s = upsertPrompt(s, { title: 'A', text: 'a', enabled: true, pinned: true })
  assert.equal(s.prompts.length, 1)
  const id = s.prompts[0].id
  s = upsertPrompt(s, { id, title: 'B' })
  assert.equal(s.prompts[0].title, 'B')
  s = upsertPrompt(s, { id, enabled: false })
  assert.equal(s.prompts[0].pinned, false)
})

test('delete 移除提示词但保留勾选记录', () => {
  let s = upsertPrompt(emptyState(), { id: 'p1', text: 'x', enabled: true })
  s = setTick(s, 's1', 'p1', true)
  s = deletePrompt(s, 'p1')
  assert.equal(s.prompts.length, 0)
  assert.deepEqual(s.ticks.s1, ['p1'])
})

test('setTick 幂等且可关闭', () => {
  let s = upsertPrompt(emptyState(), { id: 'p1', text: 'x', enabled: true })
  s = setTick(s, 's1', 'p1', true)
  s = setTick(s, 's1', 'p1', true)
  assert.deepEqual(s.ticks.s1, ['p1'])
  s = setTick(s, 's1', 'p1', false)
  assert.deepEqual(s.ticks.s1, [])
})

test('countTicks 统计勾了某条提示词的会话数', () => {
  let s = emptyState()
  s = setTick(s, 's1', 'p1', true)
  s = setTick(s, 's2', 'p1', true)
  s = setTick(s, 's3', 'p2', true)
  assert.equal(countTicks(s, 'p1'), 2)
  assert.equal(countTicks(s, 'p9'), 0)
})
```

（`emptyState` 也要 import 进来。）

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test dsh-session-prompts/test/store.test.js`
Expected: FAIL，`Cannot find module '../lib/host/store.js'`

- [ ] **Step 3: 实现 `lib/host/store.js`**

要点：`sanitizeState` 逐字段校验、丢弃没有合法 `id` 的条目、`pinned` 且 `!enabled`
时把 `pinned` 降为 `false`、`ticks` 只保留「字符串键 → 字符串数组」。
`upsertPrompt` 不带 `id` 时生成（`crypto.randomUUID()`），并保证返回新对象不原地改。
`saveState` 写 `<file>.tmp-<pid>-<rand>` 再 `fs.rename` 覆盖。
`loadState` 在文件缺失或 JSON 损坏时返回 `emptyState()`（损坏时**不**覆盖原文件）。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test dsh-session-prompts/test/store.test.js`
Expected: PASS，全部用例通过。

---

### Task 3: 生效集合解析与正文拼接

**Files:**
- Create: `dsh-session-prompts/lib/host/render.js`
- Test: `dsh-session-prompts/test/render.test.js`

**Interfaces:**
- Consumes: `State`（Task 2 的类型）
- Produces:
  - `resolveEffectiveTicks(state: State, sessionId: string, parentOf: (id: string) => string | undefined) -> string[]`
  - `renderPromptText(state: State, ids: string[]) -> string`

- [ ] **Step 1: 写失败的测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveEffectiveTicks, renderPromptText } from '../lib/host/render.js'

const states = {
  own: { version: 1, prompts: [], ticks: { s1: ['p1'] } },
  child: { version: 1, prompts: [], ticks: { s1: ['p1'] } },        // s2 无集合
  shadow: { version: 1, prompts: [], ticks: { s1: ['p1'], s2: [] } },
  grand: { version: 1, prompts: [], ticks: { s1: ['p1'] } },
  cycle: { version: 1, prompts: [], ticks: {} },
}

test('本会话有集合就直接用', () => {
  assert.deepEqual(resolveEffectiveTicks(states.own, 's1', () => undefined), ['p1'])
})

test('缺失时沿 parentSession 继承', () => {
  const parentOf = (id) => (id === 's2' ? 's1' : undefined)
  assert.deepEqual(resolveEffectiveTicks(states.child, 's2', parentOf), ['p1'])
})

test('空数组是明确的值，不再向上继承', () => {
  const parentOf = (id) => (id === 's2' ? 's1' : undefined)
  assert.deepEqual(resolveEffectiveTicks(states.shadow, 's2', parentOf), [])
})

test('多级继承，取最近的祖先', () => {
  const t = { version: 1, prompts: [], ticks: { s1: ['p1'], s2: ['p2'] } }
  const parentOf = (id) => ({ s3: 's2', s2: 's1' })[id]
  assert.deepEqual(resolveEffectiveTicks(t, 's3', parentOf), ['p2'])
})

test('parentSession 成环不死循环', () => {
  const parentOf = (id) => ({ s1: 's2', s2: 's1' })[id]
  assert.deepEqual(resolveEffectiveTicks(states.cycle, 's1', parentOf), [])
})

test('全部到顶都没有集合则返回空', () => {
  assert.deepEqual(resolveEffectiveTicks(states.own, 's9', () => undefined), [])
})

const withPrompts = {
  version: 1,
  prompts: [
    { id: 'p1', title: 'A', text: '正文一', enabled: true, pinned: false, order: 0 },
    { id: 'p2', title: 'B', text: '正文二', enabled: true, pinned: false, order: 1 },
    { id: 'p3', title: 'C', text: '正文三', enabled: false, pinned: false, order: 2 },
    { id: 'p4', title: 'D', text: '   ', enabled: true, pinned: false, order: 3 },
  ],
  ticks: {},
}

test('按传入顺序拼接，跳过停用与非空校验', () => {
  assert.equal(renderPromptText(withPrompts, ['p2', 'p1']), '正文二\n\n正文一')
})

test('停用的不贡献文本（生效中是真开关）', () => {
  assert.equal(renderPromptText(withPrompts, ['p3']), '')
})

test('空正文不贡献段落也不留分隔符', () => {
  assert.equal(renderPromptText(withPrompts, ['p4']), '')
  assert.equal(renderPromptText(withPrompts, ['p1', 'p4']), '正文一')
})

test('已删除的 id 被忽略', () => {
  assert.equal(renderPromptText(withPrompts, ['nope', 'p1']), '正文一')
})

test('正文里的花括号按字面保留', () => {
  const s = { ...withPrompts, prompts: [{ id: 'x', title: 'X', text: '用 {{name}} 表示', enabled: true, pinned: false, order: 0 }] }
  assert.equal(renderPromptText(s, ['x']), '用 {{name}} 表示')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test dsh-session-prompts/test/render.test.js`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 `lib/host/render.js`**

`resolveEffectiveTicks` 用 `visited` Set 防环，每步先查
`Object.hasOwn(state.ticks, id)`——有就返回该数组，没有再走 `parentOf`。
`renderPromptText` 按传入的 `ids` 顺序取提示词，过滤掉不存在、`!enabled`
和 `text.trim() === ''` 的，用 `'\n\n'` 连接。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test dsh-session-prompts/test/render.test.js`
Expected: PASS。

---

### Task 4: HTTP 路由

**Files:**
- Create: `dsh-session-prompts/lib/host/routes.js`
- Test: `dsh-session-prompts/test/routes.test.js`

**Interfaces:**
- Consumes: `State`、`setTick`、`upsertPrompt`、`deletePrompt`（Task 2）
- Produces: `createRoutes(deps) -> Route[]`，`Route = { kind: 'exact', path, handler(req, res) }`；
  `deps = { state: () => State, mutate: (fn) => Promise<void> }`

- [ ] **Step 1: 写失败的测试**

用假的 `req`/`res`：`req` 需要 `method`、`socket.remoteAddress`、`on('data'|'end')`；
`res` 需要 `writeHead`、`end`，加一个读回 JSON 的辅助函数。

```js
function fakeReq(method, addr, body) {
  const listeners = {}
  const req = {
    method, socket: { remoteAddress: addr },
    on(ev, fn) { (listeners[ev] ??= []).push(fn); return req },
  }
  queueMicrotask(() => {
    if (body !== undefined) for (const fn of listeners.data ?? []) fn(Buffer.from(JSON.stringify(body)))
    for (const fn of listeners.end ?? []) fn()
  })
  return req
}
function fakeRes() {
  const res = { code: 0, body: undefined,
    writeHead(c) { res.code = c },
    end(s) { res.body = s ? JSON.parse(s) : undefined },
  }
  return res
}
```

用例（都要覆盖）：

1. 非 loopback 的 GET `/state` → 403。（Review Focus 5 之外的安全项）
2. `GET /state` → 200 且返回 `{ prompts, ticks }`。
3. `POST /tick` 两次单条切换（先 `p1` on，再 `p2` on）→ 两次都保留，互不覆盖。
4. `POST /tick` `{ sessionId, promptId, on: false }` → 从集合移除。
5. `POST /tick` 缺字段 → 400。
6. `POST /prompts` `{ op: 'upsert', prompt: {...} }` → 返回新 prompts。
7. `POST /prompts` `{ op: 'delete', id }` → 该 id 消失，勾选记录保留。
8. `GET /state` 用 POST → 405。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test dsh-session-prompts/test/routes.test.js`
Expected: FAIL。

- [ ] **Step 3: 实现 `lib/host/routes.js`**

三个路径：
`/plugins/dsh-session-prompts/state`（GET）、`/prompts`（POST）、`/tick`（POST）。
loopback 判定集中在一个私有函数：`127.0.0.1`、`::1`、`::ffff:127.0.0.1`
以及 `127.0.0.0/8` 全段。读 body 有 1 MiB 上限，超限回 400。
所有写操作走 `deps.mutate`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test dsh-session-prompts/test/routes.test.js`
Expected: PASS。

---

### Task 5: 按 agent 注册 section

**Files:**
- Create: `dsh-session-prompts/lib/host/section.js`
- Test: `dsh-session-prompts/test/section.test.js`

**Interfaces:**
- Consumes: `resolveEffectiveTicks`、`renderPromptText`（Task 3）
- Produces: `createAgentSections({ register, getState, parentOf, order }) -> { ensure(agentId, sectionName), release(agentId), disposeAll() }`；
  `register(agentId, sectionDef) -> disposer`

- [ ] **Step 1: 写失败的测试**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAgentSections } from '../lib/host/section.js'

function harness(state) {
  const calls = []
  const disposed = []
  const sections = createAgentSections({
    getState: () => state,
    parentOf: () => undefined,
    order: 10150,
    register: (agentId, def) => {
      calls.push({ agentId, def })
      return () => disposed.push(agentId)
    },
  })
  return { calls, disposed, sections }
}

test('注册一次，重复 ensure 不重复注册', () => {
  const { calls, sections } = harness({ version: 1, prompts: [], ticks: {} })
  sections.ensure('a', 'plugin:session-prompts')
  sections.ensure('a', 'plugin:session-prompts')
  assert.equal(calls.length, 1)
})

test('section 关闭插值并以函数形式提供文本', () => {
  const state = { version: 1, prompts: [{ id: 'p1', title: 'A', text: '正文', enabled: true, pinned: false, order: 0 }], ticks: { a: ['p1'] } }
  const { calls, sections } = harness(state)
  sections.ensure('a', 's')
  const def = calls[0].def
  assert.equal(def.name, 's')
  assert.equal(def.order, 10150)
  assert.equal(def.interpolate, false)
  assert.equal(typeof def.text, 'function')
  assert.equal(def.text(), '正文')
})

test('未勾选时文本为空串（section 自动消失）', () => {
  const { calls, sections } = harness({ version: 1, prompts: [], ticks: {} })
  sections.ensure('a', 's')
  assert.equal(calls[0].def.text(), '')
})

test('release 只释放对应 agent', () => {
  const { disposed, sections } = harness({ version: 1, prompts: [], ticks: {} })
  sections.ensure('a', 's'); sections.ensure('b', 's')
  sections.release('a')
  assert.deepEqual(disposed, ['a'])
  sections.ensure('a', 's')
  assert.equal(disposed.length, 1)
})

test('disposeAll 释放全部', () => {
  const { disposed, sections } = harness({ version: 1, prompts: [], ticks: {} })
  sections.ensure('a', 's'); sections.ensure('b', 's')
  sections.disposeAll()
  assert.deepEqual(disposed.sort(), ['a', 'b'])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test dsh-session-prompts/test/section.test.js`
Expected: FAIL。

- [ ] **Step 3: 实现 `lib/host/section.js`**

内部 `Map<agentId, disposer>`。`ensure` 已存在则直接返回。`register` 抛错时
不写入 Map 并向上抛（由调用方决定是否吞）。`text` 是闭包，每次调用现算
`renderPromptText(getState(), resolveEffectiveTicks(getState(), agentId, parentOf))`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test dsh-session-prompts/test/section.test.js`
Expected: PASS。

- [ ] **Step 5: 接进 `index.js`**

`apply(ctx)` 里：
1. 组装 `deps`（`state` 读内存快照、`mutate` 改内存后落盘、`parentOf` 走 `ctx.sessions.get(id)?.header.parentSession`）。
2. `ctx.on('agent/created', ({ agent }) => sections.ensure(agent.id, SECTION_NAME))`。
3. `ctx.effect(() => () => sections.disposeAll())`。
4. 用 `ctx.inject(['webServer'], ...)` 挂三个路由，`webServer` 缺失时不激活而不是抛错。

- [ ] **Step 6: 语法检查 + 全量测试**

Run: `node --check dsh-session-prompts/index.js` 然后 `node --test dsh-session-prompts/test/`
Expected: 语法通过；四个测试文件全绿。

---

### Task 6: 配置页

**Files:**
- Modify: `dsh-session-prompts/client.js`

**Interfaces:**
- Consumes: Task 4 的三个路由
- Produces: `settings.section` 里 `id: 'session-prompts'` 的条目

- [ ] **Step 1: 写状态缓存与请求层**

模块级 `store`：`{ data: { prompts, ticks } }`，加 `subscribe` / `getSnapshot` /
`refresh()`。`refresh()` 拉 `GET /plugins/dsh-session-prompts/state`。
写操作用 `post(path, body)` 并 `await refresh()`。

- [ ] **Step 2: 写配置页组件**

`SettingsPage()`：读快照渲染卡片列表。每张卡片：
标题 input、正文 textarea、两个 switch、删除按钮。
编辑防抖 400ms 后 `POST /prompts { op:'upsert', prompt }`。
卡片顶部内联错误区；关闭「生效中」且该条正独立显示时，一并置 `pinned: false`
并显示 4 秒自动消失的提示。
「独立在对话框上方」在 `!enabled` 时呈灰态且点击弹提示框
（文案见 spec 的文案表），主按钮「开启并独立显示」一次写入两个字段。
空列表渲染空状态 + 「添加提示词」。

- [ ] **Step 3: 注册到 `settings.section`**

```js
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section', id: 'session-prompts', order: 5, label: () => t('nav'),
}, SettingsPage))
```

- [ ] **Step 4: 语法检查并安装**

Run: `node --check dsh-session-prompts/client.js`，然后用 `plugin_manager` 的
`install_bundle` 重装同一目录。
Expected: 语法通过，`application: applied`。

- [ ] **Step 5: 确认插槽已注册**

用 `cordis_inspect_query`（client / `Slots` / `listSubTree`，`input: {"root": "settings.section"}`）
Expected: `selected.occupants` 里出现 `id: "session-prompts"`、`order: 5`。

- [ ] **Step 6: 在页面上实测**

打开设置面板，确认：导航里有「会话提示词」；空状态显示；添加一条后卡片出现；
关掉「生效中」后点「独立在对话框上方」弹提示框；主按钮一次打开两个开关。

---

### Task 7: 对话框上方的勾选区

**Files:**
- Modify: `dsh-session-prompts/client.js`

**Interfaces:**
- Consumes: `store`（Task 6）、`POST /tick`
- Produces: `conversation.input.dock` 里 `id: 'session-prompts'` 的条目

- [ ] **Step 1: 写分组逻辑（组件内部纯函数）**

`partition(prompts, ticks, sessionId)` 返回 `{ pinned: Prompt[], grouped: Prompt[] }`：
只取 `enabled` 的，按 `pinned` 分开，各自按 `order` 升序。
`grouped` 计数只数本会话已勾的。

- [ ] **Step 2: 写 Dock 组件**

接收标准 prop `sessionId`。从快照算 `partition`。
独立条目逐行渲染 `☑/☐ 标题`；组行渲染 `⚙ 提示词 · 已挂 N 条` + 折叠箭头，
展开状态按会话存在组件内的 `Map`（或 `sessionStorage`）。
两层都空则返回 `null`。
勾选点击：先本地更新再 `POST /tick { sessionId, promptId, on }`，失败回滚该行
并在行下方显示内联错误。
样式用组件内 `<style>` 元素，只用 `--dsw-alias-*` token。

- [ ] **Step 3: 注册到 `conversation.input.dock`**

```js
ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
  name: 'conversation.input.dock', id: 'session-prompts', order: 30,
}, Dock))
```

`order: 30` 放在既有 todo(0)、goal(10)、queue(20) 之后。

- [ ] **Step 4: 语法检查并重装**

Run: `node --check dsh-session-prompts/client.js`，然后 `plugin_manager` `install_bundle`。
Expected: `application: applied`。

- [ ] **Step 5: 确认插槽与实测三种形态**

用 `cordis_inspect_query`（client / `Slots` / `listSubTree`，`input: {"root": "conversation.input.dock"}`）
Expected: occupants 出现 `id: "session-prompts"`。

然后在页面上逐一验证 spec 的三种形态（全组 / 部分独立 / 全独立）与展开态，
并验证：一行都没有时整块不渲染；勾上后下一轮对话模型确实遵守该提示词；
对话记录里没有多出任何消息。

---

### Task 8: 文档与收尾

**Files:**
- Create: `dsh-session-prompts/README.md`

**Interfaces:**
- Consumes: 全部

- [ ] **Step 1: 写 README**

必须包含：它做什么、两个界面在哪、勾选按会话记、注入不进对话记录、
改勾选会失去前缀 KV cache 复用、远程浏览器下勾选区不渲染（loopback 限制）、
与 `codebuddy-prompt-shim` 的交互（注入正文会被它逐句改写）、卸载方法。

- [ ] **Step 2: 全量测试**

Run: `node --test dsh-session-prompts/test/`
Expected: 全绿。

- [ ] **Step 3: 交付前汇报**

报告：包装在哪、验证到什么程度、哪些只是「安装成功但未人工确认」、
README 里列了哪些已知限制。
