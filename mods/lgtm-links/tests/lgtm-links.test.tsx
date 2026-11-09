import { expect, mock, test } from 'claude-code/testing'

const ran = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const run = (args: string) => ({ command: 'lgtm', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }) as const
const reply = (text: string) =>
  ({ plugin: 'lgtm-links', component: 'AssistantMessage', props: { text, isFirstOfReply: true } }) as const
const bash = (command: string, stdout: string, isRunning = false) =>
  ({ plugin: 'lgtm-links', component: 'ToolUse', props: { tool_use_id: 't1', tool: 'Bash', input: { command }, isRunning, isErrored: false, isInterrupted: false, output: { stdout } } }) as const

test('a reply that links a pull request gets a button that opens it in lgtm, linked to this session', async ($, on) => {
  const runs: string[][] = []
  on('process.run', (_, e) => (runs.push([...e.argv]), { value: ran }))
  on('env.get', (_, e) => ({ value: e.name === 'CLAUDE_CODE_HOST_SESSION_ID' ? 'local_abc' : undefined }))
  // The engine's own drawing of the reply, beneath the mod.
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...reply('Opened https://github.com/acme/shop/pull/412 for review.'), surface })
    expect((await ui.find({ key: 'acme/shop#412' }))?.text).toContain('acme/shop#412')
    await ui.press({ key: 'acme/shop#412' })
    await ui.unmount()
  }
  expect(runs).toEqual([['open', 'lgtm://acme/shop/pull/412?claude=local_abc'], ['open', 'lgtm://acme/shop/pull/412?claude=local_abc']])

  // No link, no button.
  const plain = await $.ui.mount({ ...reply('Nothing to review.'), surface: 'desktop' })
  expect(await plain.find({ key: 'acme/shop#412' })).toBeUndefined()
  await plain.unmount()
})

test('gh pr create gets the button once it has printed the PR; other commands do not', async ($, on) => {
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Bash</Text>
  })
  const made = await $.ui.mount({ ...bash('gh pr create --fill', 'https://github.com/acme/shop/pull/413\n'), surface: 'desktop' })
  expect(await made.find({ key: 'acme/shop#413' })).toBeDefined()
  await made.unmount()

  const running = await $.ui.mount({ ...bash('gh pr create --fill', '', true), surface: 'desktop' })
  expect(await running.find({ key: 'acme/shop#413' })).toBeUndefined()
  await running.unmount()

  const other = await $.ui.mount({ ...bash('gh pr view 413', 'https://github.com/acme/shop/pull/413'), surface: 'desktop' })
  expect(await other.find({ key: 'acme/shop#413' })).toBeUndefined()
  await other.unmount()
})

test('/lgtm opens the link given, else the last one in the conversation, with the CLI session when no app hosts it', async ($, on) => {
  const runs: string[][] = []
  on('process.run', (_, e) => (runs.push([...e.argv]), { value: ran }))
  on('env.get', () => ({ value: undefined }))
  on('session.id', () => ({ value: '1b2c3d4e-0000-4000-8000-000000000000' }))
  // The conversation so far, as $.session.messages() reads it (only the text is used).
  const said = [{ role: 'assistant', text: 'See https://github.com/acme/app/pull/88 and https://github.com/acme/app/pull/90.' }]
  on('session.messages', () => ({ value: said as never }))
  on('command.run', () => ({ text: '' }))

  expect((await $.command.run(run('https://github.com/acme/shop/pull/7/files'))).text).toBe('Opened acme/shop#7 in lgtm.')
  expect((await $.command.run(run(''))).text).toBe('Opened acme/app#90 in lgtm.')
  expect(runs).toEqual([
    ['open', 'lgtm://acme/shop/pull/7?claude=1b2c3d4e-0000-4000-8000-000000000000'],
    ['open', 'lgtm://acme/app/pull/90?claude=1b2c3d4e-0000-4000-8000-000000000000'],
  ])
})

test('what lgtm left for this session is handed to it once, then the file is gone', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/me', CLAUDE_CODE_HOST_SESSION_ID: 'local_abc' })
  const file = '/home/me/.config/lgtm/outbox/local_abc.md'
  let left: string | null = '**Approved** acme/shop#412\n\n---\n\nPaymentService.kt:33: make the backoff configurable'
  const sent: string[] = []
  const runs: string[][] = []
  const looked: string[] = []
  on('fs.exists', (_, e) => (looked.push(e.path), { value: e.path === file && left != null }))
  on('fs.read', () => ({ value: left ?? '' }))
  on('process.run', (_, e) => (runs.push([...e.argv]), (left = null), { value: ran }))
  on('prompt.submit', (_, e) => (sent.push(e.text), { text: e.text }))
  on('command.register', () => ({ value: { command: 'lgtm' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(3000)
  expect(looked).toContain(file)
  expect(runs).toEqual([['rm', '-f', file]])
  expect(sent).toHaveLength(1)
  expect(sent[0]).toContain('From lgtm')
  expect(sent[0]).toContain('make the backoff configurable')

  // Nothing waiting since: nothing more sent.
  await clock.advance(9000)
  expect(sent).toHaveLength(1)
})

test('a GitLab merge request link opens in lgtm by its host and project', async ($, on) => {
  const runs: string[][] = []
  on('process.run', (_, e) => (runs.push([...e.argv]), { value: ran }))
  on('env.get', (_, e) => ({ value: e.name === 'CLAUDE_CODE_HOST_SESSION_ID' ? 'local_abc' : undefined }))
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  const ui = await $.ui.mount({ ...reply('See https://gitlab.com/acme/apps/shop/-/merge_requests/12#note_3 please.'), surface: 'desktop' })
  await ui.press({ key: 'gitlab.com/acme/apps/shop#12' })
  await ui.unmount()
  expect(runs).toEqual([['open', 'lgtm://gitlab.com/acme/apps/shop/pull/12?claude=local_abc']])
})
