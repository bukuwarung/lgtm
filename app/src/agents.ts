// The coding agents lgtm works with, through their CLIs (signed in like gh and glab): Claude Code and Codex. Each one
// the CLI is installed for shows in Settings → Coding agents, where it can be switched off and given a model and effort.
// The automatic review uses the one Settings → Reviewing names; everything else (Review with…, Ask) is picked each time.
import { useEffect, useState } from 'preact/hooks';
import { command, isDesktop } from './platform.ts';

export type AgentId = 'claude' | 'codex';
export const AGENTS: Record<AgentId, {
  name: string; // in lgtm's text
  short: string; // in a button
  models?: [string, string][]; // picked from; none, its CLI's own list (detected), else typed
  efforts: string[]; // the ones it takes, when its models don't say
  install: string;
  login: string;
  mark: string; // its official mark, a 24×24 path
  color?: string; // the mark's colour; none, the text's
}> = {
  claude: {
    name: 'Claude Code',
    short: 'Claude',
    models: [['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    install: 'curl -fsSL https://claude.ai/install.sh | bash',
    login: 'claude, then /login',
    // Claude's mark (Simple Icons, CC0) in its colour.
    mark: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
    color: '#d97757',
  },
  codex: {
    name: 'Codex',
    short: 'Codex',
    efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    install: 'brew install codex',
    login: 'codex login',
    // Codex's mark (Lobe Icons, MIT).
    mark: 'M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z',
  },
};
export const AGENT_IDS = Object.keys(AGENTS) as AgentId[];
// The agent a name in lgtm's text is (a review run keeps its agent's name).
export const agentIdOf = (name?: string) => AGENT_IDS.find((id) => AGENTS[id].name === name);

export const EFFORT_NAME: Record<string, string> = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };

// Which CLIs are installed (their --version), asked once a launch, and Codex's models as its CLI last fetched them.
type Model = { id: string; name: string; efforts: string[] };
export type Detected = { id: AgentId; version: string | null; models?: Model[] | null };
let detected: Promise<Detected[]> | undefined;
let known: Detected[] | null = null;
export const detectAgents = (fresh = false): Promise<Detected[]> => {
  if (fresh || !detected)
    detected = (isDesktop ? command<Detected[]>('agents') : fetch('/agents').then((r) => (r.ok ? r.json() : [])))
      .then((d: Detected[]) => (known = Array.isArray(d) ? d : []), () => (known = []));
  return detected;
};

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
  dispatchEvent(new Event('lgtm:agents-set'));
};
// On unless switched off (Settings), and installed.
export const agentOn = (id: AgentId) => read(`agentOn.${id}`) !== '0' && !!known?.find((d) => d.id === id && d.version);
export const setAgentOn = (id: AgentId, on: boolean) => write(`agentOn.${id}`, on ? '1' : '0');
export const enabledAgents = () => AGENT_IDS.filter(agentOn);
// The models to pick from ([id, name]); none: typed.
export const modelsOf = (id: AgentId): [string, string][] | undefined =>
  AGENTS[id].models ?? known?.find((d) => d.id === id)?.models?.map((m) => [m.id, m.name]);
// The efforts a model takes (its own list, if its CLI gave one); for the default model, any of its models' (the CLI
// says no to one it doesn't take).
export const effortsOf = (id: AgentId, model: string): string[] => {
  const ms = known?.find((d) => d.id === id)?.models;
  if (!ms?.length) return AGENTS[id].efforts;
  const of = model ? ms.filter((m) => m.id === model) : ms;
  const set = new Set(of.flatMap((m) => m.efforts));
  return of.length ? AGENTS[id].efforts.filter((e) => set.has(e)) : AGENTS[id].efforts;
};
// Its model and effort (Settings → Coding agents); '' is the agent's own default.
export const agentModel = (id: AgentId) => read(`agentModel.${id}`) ?? '';
export const agentEffort = (id: AgentId) => read(`agentEffort.${id}`) ?? '';
export const setAgentModel = (id: AgentId, v: string) => write(`agentModel.${id}`, v);
export const setAgentEffort = (id: AgentId, v: string) => write(`agentEffort.${id}`, v);
// The automatic review's agent (Settings → Reviewing), else the first one on.
export const autoAgent = (): AgentId | null => {
  const pick = read('agentReviewAgent') as AgentId | null;
  return pick && agentOn(pick) ? pick : enabledAgents()[0] ?? null;
};
// The agent last asked a question, for the Ask panel to start with.
export const askAgent = (): AgentId | null => {
  const last = read('agentAsk') as AgentId | null;
  return last && agentOn(last) ? last : enabledAgents()[0] ?? null;
};
export const setAskAgent = (id: AgentId) => write('agentAsk', id);

// The agents on, kept current as Settings changes them and once detection is in.
export function useAgents() {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = () => tick((x) => x + 1);
    void detectAgents().then(t);
    addEventListener('lgtm:agents-set', t);
    return () => removeEventListener('lgtm:agents-set', t);
  }, []);
  return { on: enabledAgents(), detected: known };
}

// A prompt through an agent's CLI, its model and effort as Settings has them: the answer's text.
export async function runAgent(input: string, id: AgentId): Promise<string> {
  await detectAgents();
  const model = agentModel(id) || undefined, agent = id;
  const effort = effortsOf(id, model ?? '').includes(agentEffort(id)) ? agentEffort(id) : undefined; // one the model takes
  if (isDesktop) return command<string>('claude_text', { input, model, effort, agent });
  const res = await fetch('/claude-text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input, model, effort, agent }) });
  const d = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(d.error ?? `${AGENTS[id].name} failed`);
  return d.text;
}
