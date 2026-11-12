/**
 * The state lifecycle: load once, persist on mutate, re-read on reload.
 *
 * These tests drive lib/host/lifecycle.js against a REAL temp file, because the
 * interesting behaviour is exactly "what does the process do when the bytes on
 * disk change behind it" — a fake would prove nothing. Nothing here touches
 * `$DSH_HOME/plugin-data/`; every case uses `mkdtemp` under the OS temp dir and
 * removes it afterwards.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createStateLifecycle } from '../lib/host/lifecycle.js'
import { emptyState, isCorrupt } from '../lib/host/store.js'

/** A fresh temp dir per case, always removed. */
async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), `dsp-life-${randomUUID()}-`))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Half a JSON document: clearly the user's data, just unparsable. */
const CORRUPT_BYTES = '{ "version": 1, "prompts": [ { "id": "p1", "text": "别丢了我" '

/** A healthy file body with one enabled prompt. */
const HEALTHY = `${JSON.stringify({
  version: 1,
  prompts: [{ id: 'p1', title: '修好了', text: '正文', enabled: true, pinned: false, order: 0 }],
  ticks: { s1: ['p1'] },
}, null, 2)}\n`

/** Collects what the host would have logged. */
function recorder() {
  const logged = []
  return {
    logger: {
      error(message, error) {
        logged.push({ level: 'error', message, error })
      },
    },
    logged,
  }
}

test('启动时文件损坏：读取成功但带 corrupt 标记，写入被拒且字节不变', async () => {
  await withTempDir(async dir => {
    const file = path.join(dir, 'state.json')
    await writeFile(file, CORRUPT_BYTES, 'utf8')

    const lifecycle = createStateLifecycle({ file })
    await lifecycle.ready

    assert.equal(isCorrupt(lifecycle.state()), true)

    await assert.rejects(lifecycle.mutate(() => emptyState()), /无法解析/)

    // 写保护的核心承诺：那一份仍可手工救回的字节原样还在。
    assert.equal(await readFile(file, 'utf8'), CORRUPT_BYTES)
  })
})

test('reload 在文件修好后真的恢复：快照变健康，写入重新可用', async () => {
  await withTempDir(async dir => {
    const file = path.join(dir, 'state.json')
    await writeFile(file, CORRUPT_BYTES, 'utf8')

    const lifecycle = createStateLifecycle({ file })
    await lifecycle.ready
    assert.equal(isCorrupt(lifecycle.state()), true)

    // 用户手工修好了那份 JSON —— 这是 README 让用户做的事。
    await writeFile(file, HEALTHY, 'utf8')
    await lifecycle.reload()

    const state = lifecycle.state()
    assert.equal(isCorrupt(state), false, '重读之后不能再声称损坏')
    assert.equal(state.prompts.length, 1)
    assert.equal(state.prompts[0].id, 'p1')

    // 关键：恢复必须是可写的恢复，否则界面上的「重试」等于没修好。
    await lifecycle.mutate(current => ({ ...current, ticks: { ...current.ticks, s2: ['p1'] } }))
    assert.deepEqual(lifecycle.state().ticks.s2, ['p1'])
  })
})

test('reload 在文件仍然损坏时不清空、不解锁：仍然带 corrupt 且拒写', async () => {
  await withTempDir(async dir => {
    const file = path.join(dir, 'state.json')
    await writeFile(file, CORRUPT_BYTES, 'utf8')

    const lifecycle = createStateLifecycle({ file })
    await lifecycle.ready
    await lifecycle.reload()

    assert.equal(isCorrupt(lifecycle.state()), true, '重读没有把损坏读成空库')
    assert.equal(await readFile(file, 'utf8'), CORRUPT_BYTES, '重读本身绝不写盘')
    await assert.rejects(lifecycle.mutate(() => emptyState()), /无法解析/)
  })
})

test('reload 能把「启动时根本读不了」恢复成可用（不需要重启进程）', async () => {
  await withTempDir(async dir => {
    // 路径本身是个目录：读取抛 EISDIR/EPERM，而不是 ENOENT。
    const file = path.join(dir, 'state.json')
    await mkdir(file)

    const { logger, logged } = recorder()
    const lifecycle = createStateLifecycle({ file, logger })
    await assert.rejects(lifecycle.ready)
    assert.equal(logged.length, 1, '启动失败必须留下一条日志')

    // 读不了的时候，读和写都必须明确拒绝，而不是回答空状态。
    assert.throws(() => lifecycle.state(), /状态文件|EISDIR|EPERM|illegal|目录/i)
    await assert.rejects(lifecycle.mutate(() => emptyState()))

    // 用户把障碍清掉，放进一份能读的文件。
    await rm(file, { recursive: true, force: true })
    await writeFile(file, HEALTHY, 'utf8')
    await lifecycle.reload()

    // 这里正是「文档承诺的恢复」：没有重启，进程也认了新文件。
    assert.equal(lifecycle.state().prompts.length, 1)
    await lifecycle.mutate(current => ({ ...current, ticks: {} }))
    assert.deepEqual(lifecycle.state().ticks, {})
  })
})

test('reload 失败时保留 loadError：读继续拒、写继续拒，不会退回旧快照', async () => {
  await withTempDir(async dir => {
    const file = path.join(dir, 'state.json')
    await writeFile(file, HEALTHY, 'utf8')

    const lifecycle = createStateLifecycle({ file })
    await lifecycle.ready
    assert.equal(lifecycle.state().prompts.length, 1)

    // 文件在进程眼里变得读不了（换成目录）。
    await rm(file, { force: true })
    await mkdir(file)

    await assert.rejects(lifecycle.reload())
    assert.throws(() => lifecycle.state(), /EISDIR|EPERM|illegal|目录/i, '读不了就不能拿旧快照冒充')
    await assert.rejects(lifecycle.mutate(() => emptyState()))
  })
})

test('重读之后新建的快照替换旧的（不是合并），磁盘被外部改写也能被看见', async () => {
  await withTempDir(async dir => {
    const file = path.join(dir, 'state.json')
    await writeFile(file, HEALTHY, 'utf8')

    const lifecycle = createStateLifecycle({ file })
    await lifecycle.ready

    const external = `${JSON.stringify({
      version: 1,
      prompts: [
        { id: 'x1', title: '外部写入', text: 'a', enabled: true, pinned: false, order: 0 },
        { id: 'x2', title: '第二条', text: 'b', enabled: false, pinned: false, order: 1 },
      ],
      ticks: {},
    }, null, 2)}\n`
    await writeFile(file, external, 'utf8')
    await lifecycle.reload()

    assert.deepEqual(lifecycle.state().prompts.map(prompt => prompt.id), ['x1', 'x2'])
    assert.deepEqual(lifecycle.state().ticks, {})
  })
})

test('mutate 提交后才发布：保存失败时内存仍是上一次持久化的值', async () => {
  await withTempDir(async dir => {
    const file = path.join(dir, 'state.json')
    await writeFile(file, HEALTHY, 'utf8')

    const lifecycle = createStateLifecycle({ file })
    await lifecycle.ready

    // 让父目录不可写：把文件挪走再占位成目录，saveState 的 mkdir/rename 会失败。
    await rm(file, { force: true })
    await mkdir(file)

    await assert.rejects(
      lifecycle.mutate(current => ({ ...current, ticks: { s1: ['p1'], s9: ['p1'] } })),
    )
    assert.deepEqual(lifecycle.state().ticks.s1, ['p1'], '失败的保存不能改动内存')
    assert.equal(Object.hasOwn(lifecycle.state().ticks, 's9'), false)
  })
})

test('reload 与 mutate 共用一条链：重读不会插到一次写入的中间', async () => {
  await withTempDir(async dir => {
    const file = path.join(dir, 'state.json')
    await writeFile(file, HEALTHY, 'utf8')

    const lifecycle = createStateLifecycle({ file })
    await lifecycle.ready

    let sawDuringWrite = null
    const write = lifecycle.mutate(current => {
      // 一个很慢的变换：如果 reload 能重入，它会在这一刻插队改快照。
      sawDuringWrite = lifecycle.state()
      return { ...current, ticks: { ...current.ticks, s2: ['p1'] } }
    })
    const reload = lifecycle.reload()
    await Promise.all([write, reload])

    assert.deepEqual(sawDuringWrite.ticks.s1, ['p1'])
    // 写入先完成、重读后完成：两边都成功，且最终快照来自重读的那次读盘。
    assert.deepEqual(lifecycle.state().ticks.s2, ['p1'], '写入已经落盘并被重读看见')
  })
})

test('first read 之前 state() 拒绝回答（不能长得像「没有提示词」）', async () => {
  await withTempDir(async dir => {
    const file = path.join(dir, 'state.json')
    const lifecycle = createStateLifecycle({ file })
    // 不 await ready：立即读。
    assert.throws(() => lifecycle.state(), /尚未加载完成/)
    await lifecycle.ready
    assert.deepEqual(lifecycle.state().prompts, [], '文件不存在就是真的没有提示词')
  })
})
