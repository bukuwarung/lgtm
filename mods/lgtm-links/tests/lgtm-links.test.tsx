import { expect, test } from 'claude-code/testing'

const run = (args: string) => ({ command: 'lgtm', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }) as const
const reply = (text: string) =>
  ({ plugin: 'lgtm-links', component: 'AssistantMessage', props: { text, isFirstOfReply: true } }) as const

test('a reply that links a pull request gets a button that opens it in lgtm, on every surface', async ($, on) => {
  const runs: string[][] = []
  on('process.run', (_, e) => (runs.push([...e.argv]), { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
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
  expect(runs).toEqual([['open', 'lgtm://acme/shop/pull/412'], ['open', 'lgtm://acme/shop/pull/412']])

  // No link, no button.
  const plain = await $.ui.mount({ ...reply('Nothing to review.'), surface: 'desktop' })
  expect(await plain.find({ key: 'acme/shop#412' })).toBeUndefined()
  await plain.unmount()
})

test('/lgtm opens the link given, else the last one in the conversation', async ($, on) => {
  const runs: string[][] = []
  on('process.run', (_, e) => (runs.push([...e.argv]), { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  // The conversation so far, as $.session.messages() reads it (only the text is used).
  const said = [{ role: 'assistant', text: 'See https://github.com/acme/app/pull/88 and https://github.com/acme/app/pull/90.' }]
  on('session.messages', () => ({ value: said as never }))
  on('command.run', () => ({ text: '' }))

  expect((await $.command.run(run('https://github.com/acme/shop/pull/7/files'))).text).toBe('Opened acme/shop#7 in lgtm.')
  expect((await $.command.run(run(''))).text).toBe('Opened acme/app#90 in lgtm.')
  expect(runs).toEqual([['open', 'lgtm://acme/shop/pull/7'], ['open', 'lgtm://acme/app/pull/90']])
})
