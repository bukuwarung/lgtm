import type { EngineInterface, Register } from 'claude-code'

// Pull request links in a text, as "owner/repo#n": each once, in the order written. A GitLab merge request
// (https://host/group/…/project/-/merge_requests/n) as "host/group/…/project#n", as lgtm names it.
const PR_LINK = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)|https:\/\/([\w-]+(?:\.[\w-]+)+(?::\d+)?(?:\/[\w.-]+){2,}?)\/-\/merge_requests\/(\d+)/g
export const prsIn = (text: string): string[] =>
  [...new Set([...text.matchAll(PR_LINK)].map(m => (m[1] ? `${m[1]}#${m[2]}` : `${m[3]}#${m[4]}`)))]

// lgtm (the Mac app) opens a PR from its own link. ?claude= names this session (the Claude app's ID when it hosts it,
// else the CLI's), so the PR's ✳ Claude in lgtm comes back here, as the lgtm-review skill's links do.
const sessionId = async ($: EngineInterface) => (await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')) || (await $.session.id())
const lgtmLink = async ($: EngineInterface, pr: string) => {
  const [repo, n] = pr.split('#')
  return `lgtm://${repo}/pull/${n}?claude=${encodeURIComponent(await sessionId($))}`
}

// What you send this session from lgtm (your review, a comment to address) waits in a file of lgtm's,
// ~/.config/lgtm/outbox/<session>.md, messages separated by ---. Checked every few seconds: once there, it's read,
// deleted (so nothing is handled twice) and handed to the session, which takes it up as soon as it's free.
const outboxOf = async ($: EngineInterface) =>
  `${(await $.env.get('XDG_CONFIG_HOME')) || `${await $.env.get('HOME')}/.config`}/lgtm/outbox/${await sessionId($)}.md`
const deliverOutbox = async ($: EngineInterface, file: string) => {
  if (!(await $.fs.exists(file))) return false
  const text = (await $.fs.read(file)).trim()
  await $.process.run(['rm', '-f', file])
  if (!text) return false
  await $.prompt.submit({
    text: `From lgtm, sent to this session (messages separated by ---). Act on each: a review lists the verdict and its comments; a single comment is one to address.\n\n${text}`,
  })
  return true
}
const openInLgtm = async ($: EngineInterface, pr: string) => $.process.run(['open', await lgtmLink($, pr)])

// The row of buttons: one per PR, each opening it in lgtm.
const OpenRow = ($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], prs: string[]) => {
  const { Box, Button, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="row">
      <Text dimColor>Open in lgtm: </Text>
      {prs.map(pr => (
        <Button key={pr} label={pr} onPress={() => void openInLgtm($, pr)} />
      ))}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const file = await outboxOf($)
    let busy = false
    $.clock.every(3000, () => {
      if (busy) return
      busy = true
      void deliverOutbox($, file).finally(() => (busy = false))
    })
    await $.command.register({
      name: 'lgtm',
      description: "Open a pull request in lgtm: the link given, else the last one in this conversation, else this branch's",
      argumentHint: '[PR link]',
    })
    return next(e)
  })

  on('command.run', { command: 'lgtm' }, async ($, e) => {
    let pr = prsIn(e.args)[0]
    if (!pr) pr = (await $.session.messages()).flatMap(m => prsIn(m.text)).at(-1)
    if (!pr) pr = prsIn((await $.process.run(['gh', 'pr', 'view', '--json', 'url', '-q', '.url'])).stdout)[0]
    if (!pr) pr = prsIn((await $.process.run(['glab', 'mr', 'view', '-F', 'json'])).stdout)[0]
    if (!pr) return { text: "No pull request to open: give its link, or run /lgtm on a branch that has one." }
    const opened = await openInLgtm($, pr)
    return { text: opened.exitCode === 0 ? `Opened ${pr} in lgtm.` : "Couldn't open lgtm: is the app installed?" }
  })

  // Under a reply that links pull requests: a button for each, opening it in lgtm (the links themselves open GitHub).
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    const prs = e.props.isSummary ? [] : prsIn(e.props.text)
    if (!prs.length) return drawn
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {drawn}
        {OpenRow($, e, prs)}
      </Box>
    )
  })

  // Under the command that opened a PR (`gh pr create`, `glab mr create`), once it's done: the same button, before Claude replies.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const drawn = await next(e)
    const command = (e.props.input as { command?: unknown } | null)?.command
    if (e.props.tool !== 'Bash' || e.props.isRunning || e.props.isErrored || typeof command !== 'string' || !/\b(gh\s+pr|glab\s+mr)\s+create\b/.test(command)) return drawn
    const prs = prsIn(JSON.stringify(e.props.output ?? ''))
    if (!prs.length) return drawn
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {drawn}
        {OpenRow($, e, prs)}
      </Box>
    )
  })
}
