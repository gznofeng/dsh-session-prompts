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

test('快速提示词永远不会被注入，即使被勾着', () => {
  const s = {
    version: 1,
    prompts: [
      { id: "sys1", kind: "system", title: "S", text: "系统正文", enabled: true, pinned: false, order: 0 },
      { id: "q1", kind: "quick", title: "Q", text: "快速正文", enabled: true, pinned: false, order: 1 },
    ],
    ticks: {},
  }
  assert.equal(renderPromptText(s, ["q1"]), "")
  assert.equal(renderPromptText(s, ["q1", "sys1"]), "系统正文")
})
