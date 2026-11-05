import type { Register } from 'claude-code'

// GitHub pull request links in a text, as "owner/repo#n": each once, in the order written.
const PR_LINK = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g
export const prsIn = (text: string): string[] => [...new Set([...text.matchAll(PR_LINK)].map(m => `${m[1]}#${m[2]}`))]

// lgtm (the Mac app) opens a PR from its own link.
const lgtmLink = (pr: string) => {
  const [repo, n] = pr.split('#')
  return `lgtm://${repo}/pull/${n}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
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
    if (!pr) return { text: "No pull request to open: give its link, or run /lgtm on a branch that has one." }
    const opened = await $.process.run(['open', lgtmLink(pr)])
    return { text: opened.exitCode === 0 ? `Opened ${pr} in lgtm.` : "Couldn't open lgtm: is the app installed?" }
  })

  // Under a reply that links pull requests: a button for each, opening it in lgtm (the links themselves open GitHub).
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawn = await next(e)
    const prs = e.props.isSummary ? [] : prsIn(e.props.text)
    if (!prs.length) return drawn
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {drawn}
        <Box flexDirection="row">
          <Text dimColor>Open in lgtm: </Text>
          {prs.map(pr => (
            <Button key={pr} label={pr} onPress={() => void $.process.run(['open', lgtmLink(pr)])} />
          ))}
        </Box>
      </Box>
    )
  })
}
