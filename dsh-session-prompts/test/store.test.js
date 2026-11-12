import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { emptyState, isCorrupt, loadState, sanitizeState, saveState, upsertPrompt, deletePrompt, setTick, countTicks, UnknownPromptError } from '../lib/host/store.js'

/** 建一个独立临时目录，并在用例结束后删掉，避免留垃圾。 */
async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), `dsp-${randomUUID()}-`))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

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
  let s = upsertPrompt(emptyState(), { text: 'x', enabled: true })
  const id = s.prompts[0].id
  s = setTick(s, 's1', id, true)
  s = deletePrompt(s, id)
  assert.equal(s.prompts.length, 0)
  assert.deepEqual(s.ticks.s1, [id])
})

test('setTick 幂等且可关闭', () => {
  let s = upsertPrompt(emptyState(), { text: 'x', enabled: true })
  const id = s.prompts[0].id
  s = setTick(s, 's1', id, true)
  s = setTick(s, 's1', id, true)
  assert.deepEqual(s.ticks.s1, [id])
  s = setTick(s, 's1', id, false)
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

test('sanitize 不让 __proto__ 当 sessionId 劫持 ticks 原型', () => {
  // 关键：JSON.parse 才会把 __proto__ 变成自有可枚举键，手工编辑的文件走的正是这条路。
  // 对象字面量里的 __proto__ 是设置原型（不产生自有键），用它测不到任何东西。
  const raw = JSON.parse('{"ticks":{"__proto__":["p1"],"s1":["p1"]}}')
  const s = sanitizeState(raw)

  assert.deepEqual(s.ticks.s1, ['p1'])
  assert.equal(Object.getPrototypeOf(s.ticks), Object.prototype, 'ticks 的原型不能被替换成数组')
  // 若 __proto__ 条目被当成普通会话记录，这里会变成 2。
  assert.equal(countTicks(s, 'p1'), 1)
})

test('loadState 能解析带 UTF-8 BOM 的文件', async () => {
  await withTempDir(async dir => {
    const file = path.join(dir, 'state.json')
    // Windows 记事本另存会带 BOM；不能因此静默丢数据。
    const body = JSON.stringify({
      version: 1,
      prompts: [{ id: 'a', title: 'A', text: 'a', enabled: true, pinned: false, order: 0 }],
      ticks: { s1: ['a'] },
    })
    await writeFile(file, `\uFEFF${body}`, 'utf8')

    const s = await loadState(file)
    assert.equal(s.prompts.length, 1)
    assert.equal(s.prompts[0].id, 'a')
    assert.deepEqual(s.ticks.s1, ['a'])
  })
})

test('saveState / loadState 往返，且不留 .tmp- 残留', async () => {
  await withTempDir(async dir => {
    const file = path.join(dir, 'nested', 'state.json')
    // No `kind` here on purpose: a record written before `kind` existed must
    // come back as a system prompt, and round-trip byte-for-byte after that.
    const s = {
      version: 1,
      prompts: [{ id: 'a', title: 'A', text: 'text', enabled: true, pinned: true, order: 0 }],
      ticks: { s1: ['a'] },
    }
    const expected = {
      version: 1,
      prompts: [{ id: 'a', kind: 'system', title: 'A', text: 'text', enabled: true, pinned: true, order: 0 }],
      ticks: { s1: ['a'] },
    }
    await saveState(file, s)
    assert.deepEqual(await loadState(file), expected)

    const entries = await readdir(path.dirname(file))
    assert.deepEqual(entries.filter(name => name.includes('.tmp-')), [])
  })
})

test('upsert 带未知 id 时拒绝，而不是创建（state 不变）', () => {
  const before = sanitizeState({ prompts: [{ id: 'p1', text: '原文', enabled: true }] })

  assert.throws(
    () => upsertPrompt(before, { id: 'ghost', title: '召唤' }),
    error => error instanceof UnknownPromptError && error.id === 'ghost',
  )
  // 抛错发生在任何改动之前：既有条目、勾选、条数都没动。
  assert.deepEqual(before.prompts.map(prompt => prompt.id), ['p1'])
  assert.equal(before.prompts.length, 1)
})

test('upsert 带未知 id 被拒后，残留勾选不会被「复活」注入', () => {
  // delete 保留 ticks 是设计；旧实现里同 id 的 upsert 会把它带回来，
  // 于是下一个请求立刻又注入了那条提示词。
  let s = sanitizeState({ prompts: [{ id: 'p1', text: 'x', enabled: true }] })
  s = setTick(s, 's1', 'p1', true)
  s = deletePrompt(s, 'p1')
  assert.deepEqual(s.ticks.s1, ['p1'], '前提：勾选记录仍在')

  assert.throws(() => upsertPrompt(s, { id: 'p1', text: 'y' }), UnknownPromptError)
  assert.equal(s.prompts.length, 0)
  // 没有任何 enabled 的提示词可注入；renderPromptText 只会跳过未知 id。
  assert.equal(countTicks(s, 'p1'), 1, '审计计数仍是 1，但没有提示词可供注入')
})

test('upsert 不带 id 仍创建（新 id 由宿主生成）', () => {
  const s = upsertPrompt(emptyState(), { title: '新条目', text: '正文', enabled: true })
  assert.equal(s.prompts.length, 1)
  assert.equal(s.prompts[0].title, '新条目')
  assert.equal(typeof s.prompts[0].id, 'string')
  assert.notEqual(s.prompts[0].id, '', 'id 必须由 randomUUID() 生成')
})

test('upsert 的 id 只有空白字符时按「没给 id」处理（创建）', () => {
  const s = upsertPrompt(emptyState(), { id: '   ', text: 'x' })
  assert.equal(s.prompts.length, 1)
  assert.notEqual(s.prompts[0].id, '')
})

test('loadState 把损坏的 JSON 标记为 corrupt，而不是伪装成空状态', async () => {
  await withTempDir(async dir => {
    const file = path.join(dir, 'state.json')
    const original = '{ not json'
    await writeFile(file, original, 'utf8')

    const s = await loadState(file)
    // (a) 关键断言：必须带标记，且能用一个显式的判定函数读出来。
    assert.equal(isCorrupt(s), true, '损坏文件必须被标记，不能静默等于 emptyState()')
    assert.equal(s.corrupt, true)
    // 内容本身仍是可用的空集合，读取路径不至于崩。
    assert.deepEqual(s.prompts, [])
    assert.deepEqual(s.ticks, {})
    // 但它绝不能与真正的空状态相等 —— 否则调用方无从区分。
    assert.notDeepEqual(s, emptyState())
    // 原始字节必须原样保留，这是「仍可手工恢复」的前提。
    assert.equal(await readFile(file, 'utf8'), original)
  })
})

test('loadState 的文件不存在时是真正的空状态（不带 corrupt）', async () => {
  await withTempDir(async dir => {
    const s = await loadState(path.join(dir, 'nope.json'))
    assert.equal(isCorrupt(s), false)
    assert.deepEqual(s, emptyState(), '文件不存在才等同于「没有提示词」')
  })
})

test('corrupt 标记不会被 saveState 写进文件', async () => {
  await withTempDir(async dir => {
    const file = path.join(dir, 'state.json')
    await saveState(file, { ...emptyState(), corrupt: true })

    const written = await readFile(file, 'utf8')
    assert.equal(written.includes('corrupt'), false, '这个标记是读取层的状态，不是磁盘格式的一部分')
    const parsed = JSON.parse(written)
    assert.deepEqual(Object.keys(parsed).sort(), ['prompts', 'ticks', 'version'])
    // 读回来之后也不该再是 corrupt。
    assert.equal(isCorrupt(await loadState(file)), false)
  })
})

test('sanitizeState 不把 corrupt 当提示词数据，并丢掉它', () => {
  const s = sanitizeState({ version: 1, prompts: [{ id: 'a' }], ticks: {}, corrupt: true })
  assert.equal(s.corrupt, undefined, 'corrupt 不是 state 的组成部分')
  assert.deepEqual(Object.keys(s).sort(), ['prompts', 'ticks', 'version'])
  assert.equal(s.prompts.length, 1, '正常的提示词数据不受影响')
})

test('kind 默认是 system，缺失或非法值都回落 system', () => {
  const s = sanitizeState({
    prompts: [
      { id: "a" },
      { id: "b", kind: "quick" },
      { id: "c", kind: "bogus" },
    ],
  })
  assert.equal(s.prompts[0].kind, "system")
  assert.equal(s.prompts[1].kind, "quick")
  assert.equal(s.prompts[2].kind, "system")
})

test('快速提示词也可以 pinned（两种类型都能独立成行）', () => {
  const s = sanitizeState({ prompts: [{ id: "a", kind: "quick", enabled: true, pinned: true }] })
  assert.equal(s.prompts[0].kind, "quick")
  assert.equal(s.prompts[0].pinned, true)
})

test('快速提示词仍然遵守 pinned => enabled', () => {
  const s = sanitizeState({ prompts: [{ id: "a", kind: "quick", enabled: false, pinned: true }] })
  assert.equal(s.prompts[0].pinned, false)
})

test('upsert 可以改 kind，非法 kind 被忽略', () => {
  let s = upsertPrompt(emptyState(), { title: "A", text: "a", enabled: true })
  const id = s.prompts[0].id
  assert.equal(s.prompts[0].kind, "system")
  s = upsertPrompt(s, { id, kind: "quick" })
  assert.equal(s.prompts[0].kind, "quick")
  s = upsertPrompt(s, { id, kind: "nonsense" })
  assert.equal(s.prompts[0].kind, "quick")
})

test('快速提示词与旧数据共存：旧记录没有 kind 字段仍是 system', () => {
  const legacy = { version: 1, prompts: [{ id: "old", title: "旧", text: "旧正文", enabled: true, pinned: true, order: 0 }], ticks: {} }
  const s = sanitizeState(legacy)
  assert.equal(s.prompts[0].kind, "system")
  assert.equal(s.prompts[0].pinned, true)
})
