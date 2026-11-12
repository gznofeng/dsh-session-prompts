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

test('parentOf 抛错时文本降级为空串，不拖垮会话', () => {
  const captured = []
  const sections = createAgentSections({
    // `a` has no own tick set, so resolution must call `parentOf` to look upward.
    getState: () => ({ version: 1, prompts: [{ id: 'p1', text: '正文', enabled: true }], ticks: { p: ['p1'] } }),
    parentOf: () => { throw new Error('session service is gone') },
    order: 10150,
    register: (agentId, def) => {
      captured.push(def)
      return () => {}
    },
  })
  sections.ensure('a', 's')
  // `text` runs during prompt assembly: a throw here would fail EVERY request in
  // that session, so the only safe answer is an empty (self-hiding) section.
  assert.equal(captured[0].text(), '')
})

test('损坏状态（corrupt 标记）的注入文本是空串，不抛错', () => {
  const captured = []
  const sections = createAgentSections({
    // What `index.js` holds after `loadState` flags an unparsable file: an empty
    // state carrying the flag. `corrupt` must not leak into prompt data, and one
    // throw here would fail every request in the session.
    getState: () => ({ version: 1, prompts: [], ticks: {}, corrupt: true }),
    parentOf: () => undefined,
    order: 10150,
    register: (agentId, def) => {
      captured.push(def)
      return () => {}
    },
  })
  sections.ensure('a', 's')
  assert.equal(captured[0].text(), '')
  assert.equal(captured[0].interpolate, false)
})
