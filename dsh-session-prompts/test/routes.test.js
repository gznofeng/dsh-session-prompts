import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoutes, ROUTE_PATHS } from '../lib/host/routes.js'

/**
 * 假 req：只需 `method`、`socket.remoteAddress`、`on('data'|'end'|'error')`。
 * 载荷在下一个微任务里发出，这样处理函数有同步注册监听器的机会 —— 与真实
 * IncomingMessage 的时序一致。
 *
 * `registrations` 记录每种事件挂了几个监听器。守卫顺序（loopback 先于 method）
 * 的唯一目的就是「被拒的请求根本不该开始读 body」，而"没读 body"只能通过
 * "没挂 data 监听"来证明 —— 所以这个计数器是那条顺序声称的唯一证据。
 */
function fakeReq(method, addr, body) {
  const listeners = {}
  const req = {
    method,
    socket: { remoteAddress: addr },
    registrations: {},
    on(ev, fn) {
      (listeners[ev] ??= []).push(fn)
      req.registrations[ev] = (req.registrations[ev] ?? 0) + 1
      return req
    },
  }
  queueMicrotask(() => {
    if (body !== undefined) for (const fn of listeners.data ?? []) fn(Buffer.from(JSON.stringify(body)))
    for (const fn of listeners.end ?? []) fn()
  })
  return req
}

/** 假 req，但原样发出给定的 Buffer 分片（用来测 1 MiB 上限）。 */
function rawReq(method, addr, chunks) {
  const listeners = {}
  const req = {
    method,
    socket: { remoteAddress: addr },
    on(ev, fn) { (listeners[ev] ??= []).push(fn); return req },
  }
  queueMicrotask(() => {
    for (const chunk of chunks) for (const fn of listeners.data ?? []) fn(chunk)
    for (const fn of listeners.end ?? []) fn()
  })
  return req
}

/** 假 res：记录状态码、头，并把 body 解析回 JSON；`ended` 用来抓重复回包。 */
function fakeRes() {
  const res = {
    code: 0,
    headers: undefined,
    body: undefined,
    raw: undefined,
    ended: 0,
    writeHead(code, headers) { res.code = code; res.headers = headers },
    end(s) {
      res.ended += 1
      if (s === undefined || s === '') { res.body = undefined; return }
      res.raw = s
      res.body = JSON.parse(s)
    },
  }
  return res
}

/** 一个基线 state；每次调用都返回新对象，避免用例之间互相污染。 */
function baseState() {
  return {
    version: 1,
    prompts: [
      { id: 'p1', title: 'A', text: '正文一', enabled: true, pinned: false, order: 0 },
      { id: 'p2', title: 'B', text: '正文二', enabled: true, pinned: false, order: 1 },
    ],
    ticks: { s1: ['p1'] },
  }
}

/**
 * 注入式 deps：`state()` 读当前快照，`mutate(fn)` 立即应用并记下每次调用。
 *
 * 用 `harness.current` 而不是解构出的 `current`：解构只会读一次 getter，
 * 拿到的永远是初始快照，断言就变成在测过去的状态。
 *
 * `reload()` 在这里是「从磁盘重新读」的替身：默认是一次空操作，用例按需在 deps 上
 * 设置 `reloadTo`（重读后拿到的状态）或 `reloadThrows`（重读失败）。这两个字段在
 * `createRoutes` 之后设置也生效，因为闭包是在调用时读它们。
 */
function makeDeps(initial = baseState()) {
  let current = structuredClone(initial)
  const mutated = []
  const reloaded = []
  const deps = {
    state() { return current },
    async mutate(fn) {
      mutated.push(current)
      current = fn(current)
    },
    async reload() {
      reloaded.push(current)
      if (deps.reloadThrows !== undefined) throw deps.reloadThrows
      if (deps.reloadTo !== undefined) current = structuredClone(deps.reloadTo)
    },
  }
  return {
    deps,
    routes: createRoutes(deps),
    mutated,
    reloaded,
    get current() { return current },
  }
}

/** 找到精确路由并跑一次请求。 */
async function call(routes, path, method = 'GET', addr = '127.0.0.1', body) {
  const route = routes.find(candidate => candidate.path === path)
  assert.ok(route, `没有注册路由 ${path}`)
  const res = fakeRes()
  await route.handler(fakeReq(method, addr, body), res)
  return res
}

/** 同上，但用自定义 req（超大 body 用例）。 */
async function callRaw(routes, path, req) {
  const route = routes.find(candidate => candidate.path === path)
  assert.ok(route, `没有注册路由 ${path}`)
  const res = fakeRes()
  await route.handler(req, res)
  return res
}

const STATE = ROUTE_PATHS.state
const PROMPTS = ROUTE_PATHS.prompts
const TICK = ROUTE_PATHS.tick
const RELOAD = ROUTE_PATHS.reload

test('四条精确路由，路径固定', () => {
  assert.equal(STATE, '/plugins/dsh-session-prompts/state')
  assert.equal(PROMPTS, '/plugins/dsh-session-prompts/prompts')
  assert.equal(TICK, '/plugins/dsh-session-prompts/tick')
  assert.equal(RELOAD, '/plugins/dsh-session-prompts/reload')

  const { routes } = makeDeps()
  assert.equal(routes.length, 4)
  for (const route of routes) assert.equal(route.kind, 'exact')
  assert.deepEqual(
    routes.map(route => route.path).sort(),
    [STATE, PROMPTS, TICK, RELOAD].sort(),
  )
})

test('createRoutes 拒绝缺少 reload 的 deps（否则 /reload 只能重读内存）', () => {
  assert.throws(
    () => createRoutes({ state: () => baseState(), async mutate() {} }),
    /reload/,
  )
})

test('loopback 判定：127.0.0.0/8、::1、v4-mapped 都放行', async () => {
  // `::ffff:7f00:2` 是 127.0.0.2 的十六进制写法，同属 127/8。
  for (const addr of ['127.0.0.1', '127.0.0.2', '127.255.255.254', '::1', '::ffff:127.0.0.1', '::ffff:7f00:2']) {
    const { routes } = makeDeps()
    const res = await call(routes, STATE, 'GET', addr)
    assert.equal(res.code, 200, `${addr} 应被判定为 loopback`)
  }
})

test('非 loopback 的 GET /state → 403，且不读不写', async () => {
  for (const addr of ['8.8.8.8', '10.0.0.1', '192.168.1.5', '::2', '::ffff:10.0.0.1', '128.0.0.1']) {
    const { routes, mutated } = makeDeps()
    const res = await call(routes, STATE, 'GET', addr)
    assert.equal(res.code, 403, `${String(addr)} 必须被拒绝`)
    assert.equal(mutated.length, 0)
  }
})

test('拿不到对端地址时保守拒绝（403），不当作本机', async () => {
  // `call` 的地址参数有默认值，所以这里直接构造 req 才能表达「没有地址」。
  const { routes } = makeDeps()
  const route = routes.find(candidate => candidate.path === STATE)
  for (const socket of [undefined, {}, { remoteAddress: undefined }, { remoteAddress: '' }, { remoteAddress: 42 }]) {
    const res = fakeRes()
    const req = { method: 'GET', socket, on() { return req } }
    await route.handler(req, res)
    assert.equal(res.code, 403, `${JSON.stringify(socket)} 必须被拒绝`)
  }
})

test('非 loopback 的 POST 也不落写', async () => {
  const harness = makeDeps()
  const res = await call(harness.routes, TICK, 'POST', '8.8.8.8', { sessionId: 's1', promptId: 'p2', on: true })
  assert.equal(res.code, 403)
  assert.equal(harness.mutated.length, 0)
  assert.deepEqual(harness.current.ticks.s1, ['p1'])
})

test('GET /state → 200 返回 { prompts, ticks }', async () => {
  const { routes } = makeDeps()
  const res = await call(routes, STATE)
  assert.equal(res.code, 200)
  assert.deepEqual(res.body, { prompts: baseState().prompts, ticks: { s1: ['p1'] } })
})

test('POST /tick 两次单条切换互不覆盖', async () => {
  const harness = makeDeps({ version: 1, prompts: baseState().prompts, ticks: {} })

  const first = await call(harness.routes, TICK, 'POST', '127.0.0.1', { sessionId: 's1', promptId: 'p1', on: true })
  assert.equal(first.code, 200)
  assert.deepEqual(first.body, { sessionId: 's1', tickIds: ['p1'] })

  const second = await call(harness.routes, TICK, 'POST', '127.0.0.1', { sessionId: 's1', promptId: 'p2', on: true })
  assert.equal(second.code, 200)
  assert.deepEqual(second.body, { sessionId: 's1', tickIds: ['p1', 'p2'] })
  assert.deepEqual(harness.current.ticks.s1, ['p1', 'p2'])
})

test('POST /tick on:false 从集合移除，返回剩余集合', async () => {
  const harness = makeDeps({ version: 1, prompts: baseState().prompts, ticks: { s1: ['p1', 'p2'] } })
  const res = await call(harness.routes, TICK, 'POST', '127.0.0.1', { sessionId: 's1', promptId: 'p1', on: false })
  assert.equal(res.code, 200)
  assert.deepEqual(res.body, { sessionId: 's1', tickIds: ['p2'] })
  assert.deepEqual(harness.current.ticks.s1, ['p2'])
})

test('/tick 的响应不回全量 ticks 映射，避免与 /state 的 ticks 同键不同型', async () => {
  const harness = makeDeps({ version: 1, prompts: baseState().prompts, ticks: { s1: ['p1'], s2: ['p2'] } })
  const res = await call(harness.routes, TICK, 'POST', '127.0.0.1', { sessionId: 's1', promptId: 'p2', on: true })
  assert.equal(res.code, 200)
  assert.equal(res.body.ticks, undefined, '/tick 不能用 ticks 这个键')
  assert.deepEqual(res.body.tickIds, ['p1', 'p2'], '只回本会话的数组')
  assert.deepEqual(res.body.sessionId, 's1', '回显 sessionId 便于多请求并发时对应')
  // 别的会话不出现在响应里
  assert.equal(JSON.stringify(res.body).includes('s2'), false, '不能顺带泄漏其他会话的勾选')
})

test('POST /tick 缺字段或类型不对 → 400，且不落写', async () => {
  const bad = [
    { promptId: 'p1', on: true },                       // 缺 sessionId
    { sessionId: 's1', promptId: 'p1' },                // 缺 on
    { sessionId: 's1', on: true },                      // 缺 promptId
    { sessionId: '', promptId: 'p1', on: true },        // 空 sessionId
    { sessionId: 's1', promptId: '', on: true },        // 空 promptId
    { sessionId: 42, promptId: 'p1', on: true },        // sessionId 非字符串
    'not-an-object',
    null,
  ]
  for (const body of bad) {
    const { routes, mutated } = makeDeps()
    const res = await call(routes, TICK, 'POST', '127.0.0.1', body)
    assert.equal(res.code, 400, `应拒绝 ${JSON.stringify(body)}`)
    assert.equal(typeof res.body.error, 'string')
    assert.equal(mutated.length, 0)
  }
})

test('POST /tick 的 on 必须是严格布尔，字符串 "true" 不能静默取消勾选', async () => {
  for (const on of ['true', 'false', 1, 0, null, undefined]) {
    const harness = makeDeps()
    const res = await call(harness.routes, TICK, 'POST', '127.0.0.1', { sessionId: 's1', promptId: 'p1', on })
    assert.equal(res.code, 400, `on=${String(on)} 应被拒绝`)
    assert.equal(harness.mutated.length, 0)
    assert.deepEqual(harness.current.ticks.s1, ['p1'], '原始勾选不能被改动')
  }
})

test('POST /tick 拒绝 __proto__ / constructor / prototype 作为 sessionId', async () => {
  for (const sessionId of ['__proto__', 'constructor', 'prototype']) {
    const harness = makeDeps({ version: 1, prompts: baseState().prompts, ticks: {} })
    const res = await call(harness.routes, TICK, 'POST', '127.0.0.1', { sessionId, promptId: 'p1', on: true })
    assert.equal(res.code, 400, `${sessionId} 必须被拒绝`)
    assert.equal(harness.mutated.length, 0)
    assert.equal(Object.keys(harness.current.ticks).length, 0)
    // 原型没有被替换，也没有凭空多出键
    assert.equal(Object.getPrototypeOf(harness.current.ticks), Object.prototype)
  }
})

test('POST /prompts upsert 返回新的 prompts', async () => {
  const harness = makeDeps({ version: 1, prompts: [], ticks: { s1: ['p1'] } })
  const res = await call(harness.routes, PROMPTS, 'POST', '127.0.0.1', {
    op: 'upsert',
    prompt: { title: '新条目', text: '正文', enabled: true, pinned: false },
  })
  assert.equal(res.code, 200)
  assert.equal(res.body.prompts.length, 1)
  assert.equal(res.body.prompts[0].title, '新条目')
  assert.equal(typeof res.body.prompts[0].id, 'string')
  assert.equal(harness.current.prompts.length, 1)
  // ticks 不受影响
  assert.deepEqual(harness.current.ticks.s1, ['p1'])
})

test('POST /prompts upsert 带 id 时更新既有条目', async () => {
  const harness = makeDeps()
  const res = await call(harness.routes, PROMPTS, 'POST', '127.0.0.1', {
    op: 'upsert',
    prompt: { id: 'p1', title: '改过的标题' },
  })
  assert.equal(res.code, 200)
  assert.equal(res.body.prompts.find(prompt => prompt.id === 'p1').title, '改过的标题')
  assert.equal(harness.current.prompts.length, 2)
})

test('POST /prompts delete 让 id 消失，勾选记录保留', async () => {
  const harness = makeDeps({ version: 1, prompts: baseState().prompts, ticks: { s1: ['p1', 'p2'] } })
  const res = await call(harness.routes, PROMPTS, 'POST', '127.0.0.1', { op: 'delete', id: 'p1' })
  assert.equal(res.code, 200)
  assert.deepEqual(res.body.prompts.map(prompt => prompt.id), ['p2'])
  assert.equal(harness.current.prompts.length, 1)
  assert.deepEqual(harness.current.ticks.s1, ['p1', 'p2'], '删除提示词不能抹掉勾选审计记录')
})

test('POST /prompts 未知 op / 缺字段 → 400，且不落写', async () => {
  const bad = [
    { op: 'nope' },
    {},
    { op: 'upsert' },                       // 缺 prompt
    { op: 'upsert', prompt: 'x' },
    { op: 'delete' },                       // 缺 id
    { op: 'delete', id: '' },
    { op: 'delete', id: 7 },
    null,
  ]
  for (const body of bad) {
    const { routes, mutated } = makeDeps()
    const res = await call(routes, PROMPTS, 'POST', '127.0.0.1', body)
    assert.equal(res.code, 400, `应拒绝 ${JSON.stringify(body)}`)
    assert.equal(mutated.length, 0)
  }
})

test('方法不对 → 405（GET /state 用 POST，写路由用 GET）', async () => {
  const cases = [
    [STATE, 'POST'],
    [STATE, 'PUT'],
    [PROMPTS, 'GET'],
    [TICK, 'GET'],
    [TICK, 'DELETE'],
    [RELOAD, 'GET'],
    [RELOAD, 'PUT'],
  ]
  for (const [path, method] of cases) {
    const { routes, mutated } = makeDeps()
    const res = await call(routes, path, method, '127.0.0.1', {})
    assert.equal(res.code, 405, `${method} ${path} 应为 405`)
    assert.equal(mutated.length, 0)
  }
})

// 下面两条守的是**守卫顺序**：loopback 判定必须排在 method 判定之前。
// 单看 403 用例（都是正确方法）或 405 用例（都是 loopback）都证明不了这个顺序，
// 只有"非 loopback + 错误方法"这个交叉点能。

test('非 loopback 且方法也错 → 403 而不是 405（loopback 先于 method）', async () => {
  const cases = [
    [STATE, 'POST'],
    [STATE, 'PUT'],
    [PROMPTS, 'GET'],
    [TICK, 'GET'],
  ]
  for (const [path, method] of cases) {
    const { routes, mutated } = makeDeps()
    const res = await call(routes, path, method, '8.8.8.8', {})
    assert.equal(res.code, 403, `${method} ${path} 从远程来必须是 403，不能泄露"方法是错的"`)
    assert.equal(mutated.length, 0)
  }
})

test('被 loopback 挡下的请求根本不读 body（没挂 data 监听）', async () => {
  const { routes } = makeDeps()
  for (const path of [STATE, PROMPTS, TICK]) {
    const route = routes.find(candidate => candidate.path === path)
    const req = fakeReq('POST', '8.8.8.8', { sessionId: 's1', promptId: 'p1', on: true })
    const res = fakeRes()
    await route.handler(req, res)
    assert.equal(res.code, 403, `${path} 应被拒绝`)
    assert.equal(req.registrations.data, undefined, `${path}: 远程请求不该开始读 body`)
    assert.equal(req.registrations.end, undefined, `${path}: 远程请求不该等 end`)
    assert.equal(req.registrations.error, undefined, `${path}: 远程请求不该挂 error 处理`)
  }
})

test('405 的请求也不读 body（method 判定先于 body 读取）', async () => {
  const { routes } = makeDeps()
  const route = routes.find(candidate => candidate.path === TICK)
  const req = fakeReq('GET', '127.0.0.1', undefined)
  const res = fakeRes()
  await route.handler(req, res)
  assert.equal(res.code, 405)
  assert.equal(req.registrations.data, undefined, 'GET 没有被要求带 body，不该挂 data 监听')
})

test('body 超 1 MiB → 400，且只回一次包', async () => {
  const { routes, mutated } = makeDeps()
  const huge = Buffer.concat([
    Buffer.from('{"blob":"'),
    Buffer.alloc(1024 * 1024 + 1, 0x61),
    Buffer.from('"}'),
  ])
  const res = await callRaw(routes, TICK, rawReq('POST', '127.0.0.1', [huge]))
  assert.equal(res.code, 400)
  assert.match(res.body.error, /1 MiB|too large/i)
  assert.equal(res.ended, 1)
  assert.equal(mutated.length, 0)
})

test('坏 JSON → 400', async () => {
  const { routes, mutated } = makeDeps()
  const res = await callRaw(routes, TICK, rawReq('POST', '127.0.0.1', [Buffer.from('{ not json')]))
  assert.equal(res.code, 400)
  assert.equal(mutated.length, 0)
})

test('deps.state() 的 I/O 错误 → 500 加可读消息，不降级成空列表', async () => {
  const deps = {
    state() {
      throw Object.assign(new Error("EACCES: permission denied, open 'prompts.json'"), { code: 'EACCES' })
    },
    async mutate() {},
    async reload() {},
  }
  const routes = createRoutes(deps)
  const res = await call(routes, STATE)
  assert.equal(res.code, 500)
  assert.match(res.body.error, /EACCES|permission denied/)
  assert.equal(res.body.prompts, undefined, '失败响应不能长得像一次成功的空状态')
  assert.equal(res.body.ticks, undefined)
})

test('deps.mutate() 的 I/O 错误 → 500，不假装写入成功', async () => {
  const deps = {
    state: () => baseState(),
    async mutate() {
      throw Object.assign(new Error('EACCES: permission denied, open \'prompts.json.tmp\''), { code: 'EACCES' })
    },
    async reload() {},
  }
  const routes = createRoutes(deps)
  const res = await call(routes, TICK, 'POST', '127.0.0.1', { sessionId: 's1', promptId: 'p2', on: true })
  assert.equal(res.code, 500)
  assert.match(res.body.error, /EACCES|permission denied/)
  assert.equal(res.body.ticks, undefined, '写入失败时不能回一个空 ticks 信封，会被当成"已取消勾选"')
})

test('deps.state() 返回非对象 → 500，而不是把 undefined 当空状态', async () => {
  const deps = { state: () => null, async mutate() {}, async reload() {} }
  const routes = createRoutes(deps)
  const res = await call(routes, STATE)
  assert.equal(res.code, 500)
  assert.equal(typeof res.body.error, 'string')
})

// ===========================================================================
// 损坏状态：读要能看出问题，写必须被拒
// ===========================================================================

/**
 * 一个「解析失败」的 deps，与 index.js 交给 route 的形状一致：
 * `state()` 正常返回（带 corrupt 标记），而不是抛错 —— 因为读取本身成功了。
 *
 * `reload()` 只在 `recovers` 为真时把状态换成健康快照，用来区分
 * 「重读之后仍然损坏」与「重读之后已经修好」两条路径。
 */
function corruptDeps({ recovers = false } = {}) {
  let state = { version: 1, prompts: [], ticks: {}, corrupt: true }
  const mutated = []
  let reloads = 0
  const deps = {
    state: () => state,
    async mutate(fn) {
      // 与 index.js 的 deps.mutate 同形：损坏时它是最后一道防线，健康时正常提交。
      if (state.corrupt === true) {
        mutated.push(fn)
        throw new Error('不应该走到这里：损坏状态必须提前拒写')
      }
      mutated.push(state)
      state = fn(state)
    },
    async reload() {
      reloads += 1
      if (recovers) state = structuredClone(baseState())
    },
  }
  return {
    deps,
    routes: createRoutes(deps),
    mutated,
    get reloads() { return reloads },
    get current() { return state },
  }
}

test('GET /state 在损坏状态下仍回答 200，但带 corrupt: true', async () => {
  const { routes } = corruptDeps()
  const res = await call(routes, STATE)
  assert.equal(res.code, 200, '读取仍然要能回答，否则界面无从解释发生了什么')
  assert.equal(res.body.corrupt, true)
  assert.deepEqual(res.body.prompts, [])
  assert.deepEqual(res.body.ticks, {})
})

test('健康状态下的 /state 不带 corrupt 键（不必区分 false 与缺失）', async () => {
  const { routes } = makeDeps()
  const res = await call(routes, STATE)
  assert.equal(res.code, 200)
  assert.equal('corrupt' in res.body, false)
})

test('损坏状态下所有写路由全部拒绝，且完全不落写', async () => {
  const cases = [
    [PROMPTS, { op: 'upsert', prompt: { title: '新条目', text: '正文' } }],
    [PROMPTS, { op: 'delete', id: 'p1' }],
    [TICK, { sessionId: 's1', promptId: 'p1', on: true }],
    [TICK, { sessionId: 's1', promptId: 'p1', on: false }],
  ]
  for (const [path, body] of cases) {
    const harness = corruptDeps()
    const res = await call(harness.routes, path, 'POST', '127.0.0.1', body)
    assert.notEqual(res.code, 200, `${path} ${JSON.stringify(body)} 不能在损坏状态下写入`)
    assert.ok(res.code >= 400 && res.code < 600, `应是错误状态，收到 ${res.code}`)
    assert.equal(typeof res.body.error, 'string')
    assert.match(res.body.error, /无法解析|corrupt|recover/i)
    assert.equal(harness.mutated.length, 0, '连 mutate 都不该被调用')
  }
})

test('损坏的 upsert 不能把状态当成空库而创建一条', async () => {
  const harness = corruptDeps()
  const res = await call(harness.routes, PROMPTS, 'POST', '127.0.0.1', {
    op: 'upsert',
    prompt: { title: '覆盖用', text: '正文' },
  })
  assert.equal(res.code, 500)
  assert.equal(res.body.prompts, undefined, '失败响应不能长得像一次成功的空列表')
})

// 端到端：真的落盘一次，证明「拒绝写入」意味着文件字节没变（需求 (b)）。
test('损坏文件在写路由被拒后，磁盘字节完全没变', async () => {
  const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const { loadState } = await import('../lib/host/store.js')

  const dir = await mkdtemp(path.join(tmpdir(), 'dsp-route-'))
  try {
    const file = path.join(dir, 'state.json')
    // 半截 JSON：看起来像「用户的提示词还在」，只是解析不了。
    const original = '{ "version": 1, "prompts": [ { "id": "p1", "text": "别丢了我" '
    await writeFile(file, original, 'utf8')

    const loaded = await loadState(file)
    let wrote = false
    const deps = {
      state: () => loaded,
      async mutate(fn) {
        wrote = true
        fn(loaded)
      },
      // 真的重新读盘：这正是「重读后仍然损坏」要走的路径。
      async reload() {
        await loadState(file)
      },
    }
    const routes = createRoutes(deps)

    const res = await call(routes, PROMPTS, 'POST', '127.0.0.1', { op: 'delete', id: 'p1' })
    assert.notEqual(res.code, 200)
    assert.equal(wrote, false, '路由层必须挡在 mutate 之前')
    assert.equal(await readFile(file, 'utf8'), original, '原始字节必须原样保留，仍然可手工恢复')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ===========================================================================
// 未知 id：409，而不是顺手创建
// ===========================================================================

test('POST /prompts 带未知 id 的 upsert → 409，且 state 不变', async () => {
  const harness = makeDeps()
  const before = structuredClone(harness.current)
  const res = await call(harness.routes, PROMPTS, 'POST', '127.0.0.1', {
    op: 'upsert',
    prompt: { id: 'ghost', title: '召唤', text: '正文' },
  })

  assert.equal(res.code, 409)
  assert.equal(typeof res.body.error, 'string')
  assert.match(res.body.error, /ghost|不存在/)
  assert.equal(res.body.prompts, undefined, '失败响应不能长得像一次成功的写入')
  assert.deepEqual(harness.current, before, '被拒的 upsert 不能改动任何东西')
})

test('POST /prompts 不带 id 的 upsert 仍然是 200 创建', async () => {
  const harness = makeDeps({ version: 1, prompts: [], ticks: {} })
  const res = await call(harness.routes, PROMPTS, 'POST', '127.0.0.1', {
    op: 'upsert',
    prompt: { title: '新条目', text: '正文', enabled: true },
  })
  assert.equal(res.code, 200)
  assert.equal(res.body.prompts.length, 1)
  assert.equal(typeof res.body.prompts[0].id, 'string')
})

// ===========================================================================
// 畸形 id：400，而不是悄悄走创建路径
// ===========================================================================
//
// `upsertPrompt` 把非字符串 id 归到「没有可用 id」，也就是创建。真实 id 都是
// UUID 字符串，所以「带 id 的畸形请求」只可能是构造的或损坏的输入；静默创建
// 一条用户没要求过的提示词，比拒绝更难解释。

test('POST /prompts upsert 的 id 存在但不是字符串 → 400，且不落写', async () => {
  const badIds = [7, null, true, {}, [], 1.5]
  for (const id of badIds) {
    const harness = makeDeps()
    const before = structuredClone(harness.current)
    const res = await call(harness.routes, PROMPTS, 'POST', '127.0.0.1', {
      op: 'upsert',
      prompt: { id, title: '畸形', text: '正文' },
    })
    assert.equal(res.code, 400, `id=${JSON.stringify(id)} 应被拒绝，而不是创建一条新提示词`)
    assert.match(res.body.error, /id/)
    assert.equal(res.body.prompts, undefined, '失败响应不能长得像一次成功的写入')
    assert.equal(harness.mutated.length, 0, '连 mutate 都不该被调用')
    assert.deepEqual(harness.current, before)
  }
})

test('POST /prompts upsert 完全省略 id 仍然可以创建（400 只针对显式的非字符串 id）', async () => {
  const harness = makeDeps({ version: 1, prompts: [], ticks: {} })
  const res = await call(harness.routes, PROMPTS, 'POST', '127.0.0.1', {
    op: 'upsert',
    prompt: { title: '正常新建', text: '正文' },
  })
  assert.equal(res.code, 200)
  assert.equal(res.body.prompts.length, 1)
})

// ===========================================================================
// /reload：唯一一条会重新读盘的路由
// ===========================================================================
//
// 这条路由存在的理由只有一个：`state()` 回答的是内存快照，所以「修好文件后
// 重试」如果只重读快照就永远不可能成功。`/reload` 必须真的走到 deps.reload()。

test('POST /reload 调用 deps.reload()，并把重读后的状态按 /state 的信封回给调用方', async () => {
  const harness = makeDeps()
  harness.deps.reloadTo = {
    version: 1,
    prompts: [{ id: 'p9', title: '修好了', text: '正文', enabled: true, pinned: false, order: 0 }],
    ticks: { s9: ['p9'] },
  }

  const res = await call(harness.routes, RELOAD, 'POST', '127.0.0.1', {})

  assert.equal(res.code, 200)
  assert.equal(harness.reloaded.length, 1, '必须真的请求宿主重新读盘，而不是重读快照')
  assert.deepEqual(res.body.prompts.map(prompt => prompt.id), ['p9'], '回的是重读后的内容')
  assert.deepEqual(res.body.ticks, { s9: ['p9'] })
  assert.equal('corrupt' in res.body, false, '健康状态不该长出 corrupt 键')
})

test('损坏状态下 /reload 仍回答 200 且带 corrupt: true（读成功、写仍被拒）', async () => {
  const harness = corruptDeps()
  const res = await call(harness.routes, RELOAD, 'POST', '127.0.0.1', {})

  assert.equal(res.code, 200, '重读成功就不是错误，界面靠 corrupt 标记解释状态')
  assert.equal(harness.reloads, 1)
  assert.equal(res.body.corrupt, true)
  assert.deepEqual(res.body.prompts, [])

  // 关键：重读没有解开写保护。
  const write = await call(harness.routes, TICK, 'POST', '127.0.0.1', {
    sessionId: 's1',
    promptId: 'p1',
    on: true,
  })
  assert.equal(write.code, 500)
  assert.equal(harness.mutated.length, 0, '重读不能成为绕开写保护的后门')
})

test('重读之后文件已修好 → /reload 后写路由恢复可用', async () => {
  const harness = corruptDeps({ recovers: true })

  const reloaded = await call(harness.routes, RELOAD, 'POST', '127.0.0.1', {})
  assert.equal(reloaded.code, 200)
  assert.equal(reloaded.body.corrupt, undefined, '修好之后不能再声称损坏')
  assert.equal(reloaded.body.prompts.length, baseState().prompts.length)

  const write = await call(harness.routes, TICK, 'POST', '127.0.0.1', {
    sessionId: 's1',
    promptId: 'p2',
    on: true,
  })
  assert.equal(write.code, 200, '文件健康之后写入必须重新可用，否则「重试」等于没修好')
  assert.deepEqual(write.body.tickIds, ['p1', 'p2'])
})

test('deps.reload() 抛 I/O 错误 → 500 且不回一个像成功信封的信封', async () => {
  const harness = makeDeps()
  harness.deps.reloadThrows = Object.assign(new Error("EACCES: permission denied, open 'state.json'"), {
    code: 'EACCES',
  })

  const res = await call(harness.routes, RELOAD, 'POST', '127.0.0.1', {})

  assert.equal(res.code, 500)
  assert.match(res.body.error, /EACCES|permission denied/)
  assert.equal(res.body.prompts, undefined, '失败响应不能长得像一次成功的重读')
  assert.equal(res.body.ticks, undefined)
})

test('/reload 只接受本机回环地址', async () => {
  for (const addr of ['8.8.8.8', '10.0.0.1', '::2', '::ffff:10.0.0.1']) {
    const harness = makeDeps()
    const res = await call(harness.routes, RELOAD, 'POST', addr, {})
    assert.equal(res.code, 403, `${addr} 必须被拒绝`)
    assert.equal(harness.reloaded.length, 0, '被拒的请求根本不该读盘')
  }
})
