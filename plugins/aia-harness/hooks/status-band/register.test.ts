import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const
const PLUGIN = 'aia-harness'
const ROOT = '/repo/shop'
const MARK = JSON.stringify({ enabledPlugins: { 'aia-harness@leandro-plugins-registry': true } })
const prJson = (n: number) => JSON.stringify({ number: n, url: `https://github.com/o/r/pull/${n}`, state: 'OPEN' })

type Setup = { marked?: boolean; pm?: string[]; pr?: boolean; cwd?: string; home?: string; base?: boolean; failRuns?: number; env?: Record<string, string> }

// Fakes the world under the plugin; returns what the plugin asked of it.
function world(on: any, { marked = true, pm = [], pr = true, cwd = ROOT, home = '/home/u', base = true, failRuns = 0, env = {} }: Setup = {}) {
  const clock = mock.clock(on, { now: 1000 })
  const mem = new Map<string, unknown>()
  on('store.get', ($: any, e: any) => ({ value: mem.get(e.key) }))
  on('store.set', ($: any, e: any) => (mem.set(e.key, e.value), { value: undefined }) as never)
  if (base) on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'base slot' }))
  on('env.get', ($: any, e: any) => ({ value: e.name === 'HOME' ? home : env[e.name] }) as never)
  let prNumber = 482
  let registered = 0
  let reads = 0
  let stateWrites = 0
  on('state.set', ($: any, e: any, next: any) => (stateWrites++, next(e)))
  const ran: string[][] = []
  const cwds: (string | undefined)[] = []
  const commands: string[] = []
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId ?? 's1' }) as never)
  on('command.register', ($: any, e: any) => (registered++, { value: { command: e.name } }) as never)
  on('session.cwd', () => ({ value: cwd }))
  const isSettings = (p: string) => p.endsWith('/.claude/settings.json')
  on('fs.stat', ($: any, e: any) => (marked && isSettings(e.path) ? { value: { kind: 'file', size: 1, mtimeMs: 5, isLink: false } } : { deny: 'missing' }))
  on('fs.read', ($: any, e: any) => (isSettings(e.path) ? (reads++, marked ? { value: MARK } : { deny: 'missing' }) : { deny: 'missing' }))
  on('fs.exists', ($: any, e: any) => ({ value: e.path.includes('/.claude/worktrees/') && e.path.endsWith('/.git') }))
  on('fs.list', ($: any, e: any) => (pm.length && e.path.endsWith('/.claude/commands/pm') ? { value: pm.map((name) => ({ name, kind: 'file' })) } : { deny: 'missing' }))
  on('process.run', ($: any, e: any) => {
    ran.push(e.argv)
    cwds.push(e.init?.cwd)
    if (e.argv[0] === 'git') return { value: { exitCode: 0, stdout: 'feat/x\n', stderr: '' } }
    return pr ? { value: { exitCode: 0, stdout: prJson(prNumber), stderr: '' } } : { value: { exitCode: 1, stdout: '', stderr: 'none' } }
  })
  let gate: Promise<void> | undefined
  on('command.run', async ($: any, e: any) => {
    commands.push(e.command)
    if (failRuns-- > 0) throw new Error('boom')
    if (gate) await gate
    return { text: '' }
  })
  on('tool.call', ($: any, e: any) => ({ result: toolResults[e.tool] }) as never)
  return {
    mem, clock, ran, cwds, commands, cwd,
    gh: () => ran.filter((a) => a[0] === 'gh').length,
    setPr: (n: number) => { prNumber = n },
    hold: () => { let open = () => {}; gate = new Promise<void>((r) => { open = r }); return () => { gate = undefined; open() } },
    registered: () => registered,
    reads: () => reads,
    stateWrites: () => stateWrites,
  }
}

const toolResults: Record<string, unknown> = {}
const WT = '/repo/shop/.claude/worktrees/feat-x'
const start = ($: any, cwd = ROOT) => $.session.start({ cwd, surface: null, isInteractive: true } as never)
const mount = ($: any, props: object = BAND.props) => $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props })

test('without the mark nothing is drawn and no process runs', async ($, on) => {
  const w = world(on, { marked: false, pm: ['issue-work.md'] })
  await start($)
  await $.turn.complete({ answer: '', durationMs: 1 } as never)
  const ui = await mount($)
  expect(await ui.find({ key: 'close' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /base slot/ })).toBeDefined()
  expect(w.ran.length).toBe(0)
  await ui.unmount()
})

test('a mark without pm commands shows only the info line, run in the project cwd', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await mount($)
  expect(await ui.find({ key: 'close' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /feat\/x/ })).toBeDefined()
  expect(await ui.find({ key: 'btn-commit-pr' })).toBeUndefined()
  expect(w.cwds.every((c) => c === ROOT)).toBe(true)
  await ui.unmount()
})

test('issue-work-in-loop.md gives button 1, without it button 2', async ($, on) => {
  world(on, { pm: ['issue-work-in-loop.md', 'issue-work.md', 'commit-push-pr.md'] })
  await start($)
  let ui = await mount($)
  expect(await ui.find({ key: 'btn-issue-work-loop' })).toBeDefined()
  expect(await ui.find({ key: 'btn-issue-work' })).toBeUndefined()
  expect(await ui.find({ key: 'btn-commit-pr' })).toBeDefined()
  await ui.unmount()
})

test('without issue-work-in-loop.md the plain issue work button shows', async ($, on) => {
  world(on, { pm: ['issue-work.md'] })
  await start($)
  const ui = await mount($)
  expect(await ui.find({ key: 'btn-issue-work' })).toBeDefined()
  expect(await ui.find({ key: 'btn-issue-work-loop' })).toBeUndefined()
  await ui.unmount()
})

test('Merge PR needs a second click within 5 s and goes back after that', async ($, on) => {
  const w = world(on, { pm: ['pr-merge.md', 'commit-push-pr.md'] })
  await start($)
  const ui = await mount($)
  await ui.press({ key: 'btn-merge-pr' })
  expect(w.commands).toEqual([])
  expect(await ui.find({ key: 'btn-merge-pr', text: /#482\?/ })).toBeDefined()
  await ui.press({ key: 'btn-merge-pr' })
  expect(w.commands).toEqual(['pm:pr-merge'])
  expect(await ui.find({ key: 'btn-merge-pr', text: /\?/ })).toBeUndefined()
  // Armed again, then left alone for 6 s: a click is a first click again and nothing runs.
  await ui.press({ key: 'btn-merge-pr' })
  await w.clock.advance(6000)
  await ui.press({ key: 'btn-merge-pr' })
  expect(w.commands).toEqual(['pm:pr-merge'])
  await ui.unmount()
})

test('the close button stores hidden and the band disappears; /aia-bar on brings it back', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await mount($)
  await ui.press({ key: 'close' })
  expect(w.mem.get('hidden')).toBe(true)
  expect(await ui.find({ key: 'close' })).toBeUndefined()
  await $.command.run({ command: 'aia-bar', args: 'on' })
  expect(w.mem.get('hidden')).toBe(false)
  expect(await ui.find({ key: 'close' })).toBeDefined()
  await $.command.run({ command: 'aia-bar', args: '' })
  expect(w.mem.get('hidden')).toBe(true)
  await ui.unmount()
})

test('two updates in a row make one gh query', async ($, on) => {
  const w = world(on)
  await start($)
  await $.turn.complete({ answer: '', durationMs: 1 } as never)
  await $.turn.complete({ answer: '', durationMs: 1 } as never)
  expect(w.gh()).toBe(1)
})

test('a survey takes the space', async ($, on) => {
  world(on)
  await start($)
  const ui = await mount($, { ...BAND.props, hasSurvey: true })
  expect(await ui.find({ key: 'close' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /base slot/ })).toBeDefined()
  await ui.unmount()
})

test('a hidden band makes no query, and /clear keeps hidden', async ($, on) => {
  const w = world(on)
  await start($)
  w.mem.set('hidden', true)
  // Past the 60 s cache: a visible band would query again here.
  await w.clock.advance(61_000)
  await $.turn.complete({ answer: '', durationMs: 1 } as never)
  await $.session.end({ reason: 'clear' } as never)
  expect(w.mem.get('hidden')).toBe(true)
  const ui = await mount($)
  expect(await ui.find({ key: 'close' })).toBeUndefined()
  await ui.unmount()
  expect(w.gh()).toBe(1)
})

const label = async (ui: any, key: string) => (await ui.find({ key }))?.text
const tick = () => new Promise((r) => setTimeout(r, 0))

test('a fast double click on an armed Merge PR runs the command once', async ($, on) => {
  const w = world(on, { pm: ['pr-merge.md'] })
  await start($)
  const ui = await mount($)
  await ui.press({ key: 'btn-merge-pr' })
  await Promise.all([ui.press({ key: 'btn-merge-pr' }), ui.press({ key: 'btn-merge-pr' })])
  expect(w.commands).toEqual(['pm:pr-merge'])
  await ui.unmount()
})

test('the confirm is bound to its PR: a new PR number makes the click a first click', async ($, on) => {
  const w = world(on, { pm: ['pr-merge.md'] })
  await start($)
  const ui = await mount($)
  // Arm late in the 60 s cache window, so the PR lookup expires inside the 5 s confirm window.
  await w.clock.advance(58_000)
  await ui.press({ key: 'btn-merge-pr' })
  w.setPr(483)
  await w.clock.advance(3000)
  await $.turn.complete({ answer: '', durationMs: 1 } as never)
  expect(await ui.find({ key: 'btn-merge-pr', text: /\?/ })).toBeUndefined()
  await ui.press({ key: 'btn-merge-pr' })
  expect(w.commands).toEqual([])
  expect(await ui.find({ key: 'btn-merge-pr', text: /#483\?/ })).toBeDefined()
  await ui.unmount()
})

test('clicks while a button command is pending do nothing', async ($, on) => {
  const w = world(on, { pm: ['commit-push-pr.md'] })
  const release = w.hold()
  await start($)
  const ui = await mount($)
  const first = ui.press({ key: 'btn-commit-pr' })
  await tick()
  await ui.press({ key: 'btn-commit-pr' })
  expect(w.commands).toEqual(['pm:commit-push-pr'])
  release()
  await first
  await ui.press({ key: 'btn-commit-pr' })
  expect(w.commands.length).toBe(2)
  await ui.unmount()
})

test('two same-tick clicks on Commit+PR run the command once', async ($, on) => {
  const w = world(on, { pm: ['commit-push-pr.md'] })
  await start($)
  const ui = await mount($)
  await Promise.all([ui.press({ key: 'btn-commit-pr' }), ui.press({ key: 'btn-commit-pr' })])
  expect(w.commands).toEqual(['pm:commit-push-pr'])
  await ui.unmount()
})

test('two same-tick clicks on Issue work run the command once', async ($, on) => {
  const w = world(on, { pm: ['issue-work.md'] })
  await start($)
  const ui = await mount($)
  await Promise.all([ui.press({ key: 'btn-issue-work' }), ui.press({ key: 'btn-issue-work' })])
  expect(w.commands).toEqual(['pm:issue-work'])
  await ui.unmount()
})

test('busy is released after a failed command', async ($, on) => {
  const w = world(on, { pm: ['commit-push-pr.md'], failRuns: 1 })
  await start($)
  const ui = await mount($)
  await ui.press({ key: 'btn-commit-pr' })
  await ui.press({ key: 'btn-commit-pr' })
  expect(w.commands).toEqual(['pm:commit-push-pr', 'pm:commit-push-pr'])
  await ui.unmount()
})

test('a failing command still shows the failure toast and releases busy', async ($, on) => {
  const w = world(on, { pm: ['commit-push-pr.md'], failRuns: 1 })
  const toasts: string[] = []
  on('ui.toast', ($: any, e: any) => (toasts.push(e.message ?? e.text ?? JSON.stringify(e)), { value: undefined } as never))
  await start($)
  const ui = await mount($)
  await ui.press({ key: 'btn-commit-pr' })
  expect(toasts.filter((t) => t.includes('could not run'))).toHaveLength(1)
  await ui.press({ key: 'btn-commit-pr' })
  expect(w.commands).toEqual(['pm:commit-push-pr', 'pm:commit-push-pr'])
  await ui.unmount()
})

test('a state read failing after the command ran shows no failure toast and still releases busy', async ($, on) => {
  const w = world(on, { pm: ['commit-push-pr.md'] })
  const toasts: string[] = []
  on('ui.toast', ($: any, e: any) => (toasts.push(e.message ?? e.text ?? JSON.stringify(e)), { value: undefined } as never))
  let broken = true
  let thrown = 0
  on('state.get', ($: any, e: any, next: any) => {
    if (broken && w.commands.length > 0) { thrown++; return { deny: 'read failed' } as never }
    return next(e)
  })
  await start($)
  const ui = await mount($)
  await ui.press({ key: 'btn-commit-pr' })
  expect(w.commands).toEqual(['pm:commit-push-pr'])
  expect(thrown).toBeGreaterThan(0)
  expect(toasts.filter((t) => t.includes('could not run'))).toEqual([])
  broken = false
  await ui.unmount()
  const ui2 = await mount($)
  await ui2.press({ key: 'btn-commit-pr' })
  expect(w.commands).toHaveLength(2)
  await ui2.unmount()
})

test('the second click of the Merge PR confirm still runs after the first released busy', async ($, on) => {
  const w = world(on, { pm: ['pr-merge.md'] })
  await start($)
  const ui = await mount($)
  await ui.press({ key: 'btn-merge-pr' })
  expect(w.commands).toEqual([])
  await ui.press({ key: 'btn-merge-pr' })
  expect(w.commands).toEqual(['pm:pr-merge'])
  await ui.unmount()
})

test('after a button command the next refresh asks gh again, inside the backoff', async ($, on) => {
  const w = world(on, { pr: false, pm: ['commit-push-pr.md'] })
  await start($)
  expect(w.gh()).toBe(1)
  const ui = await mount($)
  await ui.press({ key: 'btn-commit-pr' })
  expect(w.gh()).toBe(2)
  await ui.unmount()
})

test('the armed label shows, then reverts after 5 s without any click', async ($, on) => {
  const w = world(on, { pm: ['pr-merge.md'] })
  await start($)
  const ui = await mount($)
  expect(await label(ui, 'btn-merge-pr')).toBe('[Merge PR]')
  await ui.press({ key: 'btn-merge-pr' })
  expect(await label(ui, 'btn-merge-pr')).toBe('[Merge PR #482?]')
  await w.clock.advance(5001)
  expect(await label(ui, 'btn-merge-pr')).toBe('[Merge PR]')
  await ui.unmount()
})

test('Remove worktree needs a second click and shows its own armed label', async ($, on) => {
  const w = world(on, { cwd: WT, pm: ['worktree-remove.md'] })
  await start($, WT)
  const ui = await mount($)
  await ui.press({ key: 'btn-remove-worktree' })
  expect(w.commands).toEqual([])
  expect(await label(ui, 'btn-remove-worktree')).toBe('[Remove worktree?]')
  await ui.press({ key: 'btn-remove-worktree' })
  expect(w.commands).toEqual(['pm:worktree-remove'])
  await ui.unmount()
})

test('EnterWorktree refreshes in the new directory; ExitWorktree uses restoredCwd when originalCwd is gone', async ($, on) => {
  const w = world(on, { pm: ['worktree-remove.md'] })
  await start($)
  toolResults.EnterWorktree = { worktreePath: WT, message: 'ok' }
  await $.tool.call({ tool: 'EnterWorktree' } as never)
  expect(w.cwds[w.cwds.length - 1]).toBe(WT)
  const ui = await mount($)
  expect(await ui.find({ key: 'btn-remove-worktree' })).toBeDefined()
  toolResults.ExitWorktree = { action: 'keep', originalCwd: '/gone', restoredCwd: ROOT, originalCwdMissing: true, worktreePath: WT, message: 'ok' }
  await w.clock.advance(61_000)
  await $.tool.call({ tool: 'ExitWorktree' } as never)
  expect(w.cwds[w.cwds.length - 1]).toBe(ROOT)
  expect(await ui.find({ key: 'btn-remove-worktree' })).toBeUndefined()
  await ui.unmount()
})

test('/clear drops an armed confirm and keeps hidden', async ($, on) => {
  const w = world(on, { pm: ['pr-merge.md'] })
  await start($)
  const ui = await mount($)
  await ui.press({ key: 'btn-merge-pr' })
  await $.session.end({ reason: 'clear' } as never)
  await ui.press({ key: 'btn-merge-pr' })
  expect(w.commands).toEqual([])
  w.mem.set('hidden', true)
  await $.session.end({ reason: 'clear' } as never)
  expect(w.mem.get('hidden')).toBe(true)
  await ui.unmount()
})

test('ui.render with no other hook below still draws the band', async ($, on) => {
  world(on, { base: false })
  await start($)
  const ui = await mount($)
  expect(await ui.find({ key: 'close' })).toBeDefined()
  await ui.unmount()
})

test('a subagent turn and a headless session spawn nothing', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false } as never)
  await $.turn.complete({ answer: '', durationMs: 1 } as never)
  expect(w.ran.length).toBe(0)
  await start($)
  const n = w.ran.length
  await w.clock.advance(61_000)
  await $.turn.complete({ answer: '', durationMs: 1, agentId: 'sub-1' } as never)
  expect(w.ran.length).toBe(n)
})

test('/aia-bar registers once, after the mark is found, and an unmarked project writes no state', async ($, on) => {
  const off = world(on, { marked: false })
  await start($)
  await $.turn.complete({ answer: '', durationMs: 1 } as never)
  expect(off.registered()).toBe(0)
  expect(off.stateWrites()).toBe(0)
})

test('/aia-bar is registered exactly once in a marked project', async ($, on) => {
  const w = world(on)
  await start($)
  await $.turn.complete({ answer: '', durationMs: 1 } as never)
  expect(w.registered()).toBe(1)
})

test('a session that starts with hidden already stored registers /aia-bar once and runs no git or gh', async ($, on) => {
  const w = world(on)
  w.mem.set('hidden', true)
  await start($)
  await $.turn.complete({ answer: '', durationMs: 1 } as never)
  expect(w.registered()).toBe(1)
  expect(w.ran.length).toBe(0)
  const ui = await mount($)
  expect(await ui.find({ key: 'close' })).toBeUndefined()
  await $.command.run({ command: 'aia-bar', args: 'on' })
  expect(await ui.find({ key: 'close' })).toBeDefined()
  await ui.unmount()
})

test('an unmarked project with hidden stored registers nothing and runs nothing', async ($, on) => {
  const off = world(on, { marked: false })
  off.mem.set('hidden', true)
  await start($)
  expect(off.registered()).toBe(0)
  expect(off.ran.length).toBe(0)
})

test('the home directory is never read as a project', async ($, on) => {
  const w = world(on, { cwd: '/home/u', home: '/home/u/' })
  await start($, '/home/u')
  expect(w.reads()).toBe(0)
  expect(w.ran.length).toBe(0)
  const ui = await mount($)
  expect(await ui.find({ key: 'close' })).toBeUndefined()
  await ui.unmount()
})

test('a root equal to the home directory via USERPROFILE only is refused', async ($, on) => {
  const w = world(on, { cwd: 'C:/Users/ana', home: '', env: { USERPROFILE: 'c:\\users\\ana' } })
  await start($, 'C:/Users/ana')
  expect(w.reads()).toBe(0)
  expect(w.registered()).toBe(0)
  expect(w.ran.length).toBe(0)
  const ui = await mount($)
  expect(await ui.find({ key: 'close' })).toBeUndefined()
  await ui.unmount()
})
