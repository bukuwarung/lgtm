import type { ComponentChildren } from 'preact';
import { highlightCode, rainbow, splitLines } from './highlight.ts';
import { md } from './markdown.ts';
import { FileIcon, ModuleIcon } from './shortcuts.tsx';
import { folderIcon } from './fileicons.ts';
import { CheckMark, Octicon, Tg, Who } from './tags.tsx';
import { markProps, themeStyle } from './look.ts';
import { ThemeThumb } from './themecard.tsx';
import { BUILTIN_THEMES } from './themes.ts';
import { parseDoc } from './docs.ts';
import { reviewPlan, stepIcon, stepOrder } from './files.ts';
import { useStoredValue, term } from './platform.ts';
import { changedRange, parseString, stringHtml } from './strings.ts';

// The words of the site on show: GitHub's PRs and teams, or GitLab's MRs and groups (the avatar's menu; switching reloads).
const T = term();

// Small, made-up examples of each diff helper, drawn with the app's own styles: shown beside the switches in
// Settings, and captured as the README's pictures (`npm run demos`). No real code from any PR.

type Row = [kind: '+' | '-' | ' ', old: number | '', now: number | '', code: string, cls?: string];
const kt = (code: string) => highlightCode(code, 'kotlin');

function Rows({ rows, extra }: { rows: Row[]; extra?: ComponentChildren }) {
  return (
    <table class="diff">
      <tbody>
        {rows.map(([k, o, n, code, cls]) => (
          <tr class={`ln${k === '+' ? ' a' : k === '-' ? ' d' : ''}${cls ? ' ' + cls : ''}`}>
            <td class="num">{o}</td>
            <td class="num">{n}</td>
            <td class="code" dangerouslySetInnerHTML={{ __html: /^\s*</.test(code) || code.includes('<mark') ? code : kt(code) }} />
          </tr>
        ))}
        {extra}
      </tbody>
    </table>
  );
}

function File({ path, st = 'modified', add, del, mod, untested, chips, children }: { path: string; st?: string; add: number; del: number; mod?: string; untested?: boolean; chips?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <section class="file">
      <header class="file-h">
        {st !== 'modified' && <span class={`st s-${st}`}><Tg i={st} t={st} /></span>}
        <a class="file-name" title={path}>
          <FileIcon path={path} big untested={untested} />
          <b>{path.slice(path.lastIndexOf('/') + 1)}</b>
          {mod && (
            <span class="file-mod">
              <ModuleIcon /> {mod}
            </span>
          )}
          {path.includes('/') && <span class="file-dir"><bdi>{path.slice(0, path.lastIndexOf('/'))}</bdi></span>}
        </a>
        <span class="counts">
          <b class="a">+{add}</b> <b class="d">−{del}</b>
        </span>
        {chips}
      </header>
      {children}
    </section>
  );
}

const Fold = ({ text }: { text: string }) => (
  <tr class="import-fold">
    <td colSpan={3}>
      <button>{text}</button>
    </td>
  </tr>
);

const IMPORTS: Row[] = [
  ['+', '', 1, 'package com.acme.orders'],
  ['+', '', 2, ''],
  ['+', '', 3, 'import com.acme.core.Money'],
  ['+', '', 4, 'import javax.inject.Inject'],
  ['+', '', 5, 'import kotlinx.coroutines.flow.Flow'],
  ['+', '', 6, 'import retrofit2.http.GET'],
  ['+', '', 7, ''],
];
const BODY: Row[] = [
  ['+', '', 8, 'class OrderRepo @Inject constructor('],
  ['+', '', 9, '    private val api: OrderApi,'],
  ['+', '', 10, ') {'],
];

const WS_OFF: Row[] = [
  ['-', 4, '', 'fun total(items: List<Item>) ='],
  ['-', 5, '', 'items.sumOf { it.price }'],
  ['+', '', 4, 'fun total(items: List<Item>) ='],
  ['+', '', 5, '    items.sumOf { it.price }'],
];
const WS_ON: Row[] = [
  [' ', 4, 4, 'fun total(items: List<Item>) ='],
  [' ', 5, 5, '    items.sumOf { it.price }'],
];

// A line with its changed words marked: each part highlighted on its own, so the mark can't fall inside a token's span.
const mark = (code: string, word: string, cls: string) => {
  const i = code.indexOf(word);
  return i < 0 ? kt(code) : `${kt(code.slice(0, i))}<mark class="${cls}">${kt(word)}</mark>${kt(code.slice(i + word.length))}`;
};

const MD_SRC = '## Rollout\n\n- Ship behind the `orders_v2` flag\n- **Remove** the old screen next sprint';

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="72" height="72"><path fill="#92BDFF" d="M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path fill="#1F5BD8" d="M7 15l3-4 2.5 3 1.5-2 3 3z"/><circle cx="9" cy="8" r="1.6" fill="#F5B83D"/></svg>`;

const BOT_TEXT = 'Coverage report: 82.4% of lines (+0.3%), 71.0% of branches. 14 files changed, 3 with lower coverage: OrderRepository.kt, CartViewModel.kt, PaymentSheet.kt. Details in the CI run.';

const DOC = `/**
 * Sums the [Item] prices in the cart.
 *
 * @param items what's in the cart
 * @return the total, in cents
 */
fun total(items: List<Item>): Long`;
// The rendered doc (same parsing as the diff), as HTML for a demo row.
function docHtml(text: string) {
  const { body, tags } = parseDoc(text.slice(0, text.indexOf('*/') + 2), 'kdoc');
  const rows = tags.map(([label, items]) => `<dt>${label}:</dt><dd>${items.map(([n, t]) => (n ? `<code>${n}</code> – ` : '') + md.renderInline(t)).join('<br>')}</dd>`).join('');
  return `<div class="md">${md.render(body)}</div><dl class="doc-tags">${rows}</dl>`;
}

export type Demo = { title: string; off: ComponentChildren; on: ComponentChildren };

export const DEMOS: Record<string, Demo> = {
  sinceFirst: {
    title: 'Changes since your last review',
    off: (
      <>
        {['OrderRepository.kt', 'OrderApi.kt', 'CartViewModel.kt', 'build.gradle.kts', 'README.md'].map((p, i) => (
          <File path={p} add={[42, 8, 15, 2, 6][i]} del={[3, 0, 9, 1, 0][i]} />
        ))}
      </>
    ),
    on: (
      <>
        <div class="since on">
          <span>
            Showing changes since your last review (<code>a1b2c3d</code> → <code>e4f5a6b</code>) · 1 file
          </span>
        </div>
        <File path="CartViewModel.kt" add={2} del={1} />
      </>
    ),
  },
  foldImports: {
    title: 'Fold package and import blocks',
    off: (
      <File path="OrderRepository.kt" st="added" add={10} del={0}>
        <Rows rows={[...IMPORTS, ...BODY]} />
      </File>
    ),
    on: (
      <File path="OrderRepository.kt" st="added" add={10} del={0}>
        <table class="diff">
          <tbody>
            <Fold text="⋯ +4 imports · new: retrofit2" />
          </tbody>
        </table>
        <Rows rows={BODY} />
      </File>
    ),
  },
  hideArchivedSpecs: {
    title: 'Hide archived specs',
    off: (
      <>
        <File path="docs/specs/payment-retries.md" add={24} del={2} />
        <File path="docs/specs/archive/payment-retries-v1.md" add={180} del={0} />
      </>
    ),
    on: (
      <>
        <File path="docs/specs/payment-retries.md" add={24} del={2} />
        <button class="gen-row">1 archived spec hidden. Show</button>
      </>
    ),
  },
  hideGenerated: {
    title: 'Hide generated files',
    off: (
      <>
        <File path="OrderRepository.kt" add={42} del={3} />
        <File path="build/generated/OrderDto.kt" add={380} del={0} />
        <File path="build/generated/OrderQueries.kt" add={512} del={41} />
      </>
    ),
    on: (
      <>
        <File path="OrderRepository.kt" add={42} del={3} />
        <button class="gen-row">2 generated files hidden. Show</button>
      </>
    ),
  },
  hideNoDiff: {
    title: 'Hide files moved without changes',
    off: (
      <>
        <File path="orders/OrderRepository.kt" add={42} del={3} />
        <File path="orders/ui/OrderRow.kt" st="renamed" add={0} del={0} />
        <File path="orders/ui/OrderList.kt" st="renamed" add={0} del={0} />
      </>
    ),
    on: (
      <>
        <File path="orders/OrderRepository.kt" add={42} del={3} />
        <button class="gen-row">2 files renamed or moved without changes hidden. Show</button>
      </>
    ),
  },
  collapseDeleted: {
    title: 'Collapse deleted files',
    off: (
      <File path="LegacyCheckout.kt" st="removed" add={0} del={120}>
        <Rows rows={[['-', 1, '', 'class LegacyCheckout {'], ['-', 2, '', '    fun pay(order: Order) {'], ['-', 3, '', '        // …'], ['-', 4, '', '    }']]} />
      </File>
    ),
    on: (
      <File path="LegacyCheckout.kt" st="removed" add={0} del={120}>
        <button class="collapsed-row">Deleted. Show its 120 lines</button>
      </File>
    ),
  },
  dimMoved: {
    title: 'Dim code moved without changes',
    off: (
      <File path="OrderMapper.kt" st="added" add={3} del={0}>
        <Rows rows={[['+', '', 12, 'fun Order.toUi() = OrderUi('], ['+', '', 13, '    id = id,'], ['+', '', 14, '    total = total.format(),'], ['+', '', 15, ')']]} />
      </File>
    ),
    on: (
      <File path="OrderMapper.kt" st="added" add={3} del={0}>
        <table class="diff">
          <tbody>
            <tr class="moved-h">
              <td colSpan={3}>↰ Moved here from <a>OrderViewModel.kt:88</a> without changes</td>
            </tr>
          </tbody>
        </table>
        <Rows rows={[['+', '', 12, 'fun Order.toUi() = OrderUi(', 'moved'], ['+', '', 13, '    id = id,', 'moved'], ['+', '', 14, '    total = total.format(),', 'moved'], ['+', '', 15, ')', 'moved']]} />
      </File>
    ),
  },
  wordDiff: {
    title: 'Highlight the changed words',
    off: (
      <File path="Pricing.kt" add={1} del={1}>
        <Rows rows={[['-', 7, '', 'val fee = amount * 0.02'], ['+', '', 7, 'val fee = amount * FEE_RATE']]} />
      </File>
    ),
    on: (
      <File path="Pricing.kt" add={1} del={1}>
        <Rows rows={[['-', 7, '', mark('val fee = amount * 0.02', '0.02', 'wd-del')], ['+', '', 7, mark('val fee = amount * FEE_RATE', 'FEE_RATE', 'wd-add')]]} />
      </File>
    ),
  },
  ignoreWs: {
    title: 'Ignore whitespace-only changes',
    off: (
      <File path="Totals.kt" add={2} del={2}>
        <Rows rows={WS_OFF} />
      </File>
    ),
    on: (
      <File path="Totals.kt" add={2} del={2}>
        <Rows rows={WS_ON} />
      </File>
    ),
  },
  richMarkdown: {
    title: 'Markdown rendered',
    off: (
      <File path="docs/rollout.md" add={4} del={0}>
        <Rows rows={MD_SRC.split('\n').map((l, i) => ['+', '', i + 1, md.utils.escapeHtml(l) || ' '] as Row).map((r) => [r[0], r[1], r[2], `<span>${r[3]}</span>`] as Row)} />
      </File>
    ),
    // Rendered, and still commented line by line: a thread under its line, and a block's "+" (shown on hover)
    // opening the comment box.
    on: (
      <File path="docs/rollout.md" add={4} del={0}>
        <div class="md demo-md chunk demo-chunk">
          <h2 data-src="1-1" data-chg="">Rollout</h2>
          <ul>
            <li data-src="3-3" data-chg="">
              Ship behind the <code>orders_v2</code> flag
              <div class="note-host">
                <div class="notes">
                  <div class="thread">
                    <div class="comment">
                      <b>you</b> <time>just now</time>
                      <div class="md">
                        <p>Who turns the flag on, and when?</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </li>
            <li data-src="4-4" data-chg="" class="demo-plus">
              <strong>Remove</strong> the old screen next sprint
              <div class="note-host">
                <div class="draft-form">
                  <div class="badge">Line 4</div>
                  <div class="editor">
                    <div class="ed-bar">
                      <button type="button" class="ed-tab on">Write</button>
                      <button type="button" class="ed-tab">Preview</button>
                    </div>
                    <div class="ed-write">
                      <textarea rows={2} value="Can we link the ticket for the removal?" />
                    </div>
                  </div>
                  <div class="row">
                    <button class="primary">Add to review</button>
                    <button>Cancel</button>
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </File>
    ),
  },
  previewImages: {
    title: 'Images as pictures',
    off: (
      <File path="res/drawable/ic_orders.xml" st="added" add={9} del={0}>
        <Rows
          rows={['<vector android:width="24dp"', '    android:height="24dp"', '    android:viewportWidth="24"', '    android:viewportHeight="24">', '  <path android:fillColor="#92BDFF"', '    android:pathData="M4,3h16…"/>']
            .map((l, i) => ['+', '', i + 1, `<span>${md.utils.escapeHtml(l)}</span>`] as Row)}
        />
      </File>
    ),
    on: (
      <File path="res/drawable/ic_orders.xml" st="added" add={9} del={0}>
        <div class="vector-preview">
          <figure>
            <img src={'data:image/svg+xml,' + encodeURIComponent(ICON)} alt="" style={{ height: '96px' }} />
            <figcaption>New · 24×24dp</figcaption>
          </figure>
        </div>
      </File>
    ),
  },
  renderDocs: {
    title: 'Render doc comments',
    off: (
      <File path="Pricing.kt" st="added" add={7} del={0}>
        <Rows rows={splitLines(kt(DOC)).map((l, i) => ['+', '', 20 + i, l] as Row)} />
      </File>
    ),
    on: (
      <File path="Pricing.kt" st="added" add={7} del={0}>
        <Rows rows={[['+', '', 20, `<div class="doc-render" style="width: calc(100% - 3ch)">${docHtml(DOC)}</div>`], ['+', '', 26, 'fun total(items: List<Item>): Long']]} />
      </File>
    ),
  },
  foldBots: {
    title: 'Bot comments behind one line',
    off: (
      <div class="conversation">
        <div class="comment">
          <b>coverage-bot</b> <time>2 hours ago</time>
          <div class="md">
            <p>{BOT_TEXT}</p>
          </div>
        </div>
      </div>
    ),
    on: (
      <div class="conversation">
        <details class="bots-hidden">
          <summary><Octicon name="dependabot" /> 1 comment from bots</summary>
        </details>
      </div>
    ),
  },
};

// Without → with, side by side. `active`: which side the current setting gives (outlined).
// In the order the steps are dragged into (Settings): the view model's test stays right below it; the flow test, whose
// code isn't in the PR, goes with the Tests step.
function ReadingOrderOn() {
  const [saved] = useStoredValue('readingSteps', '');
  return <>{reviewPlan(READING, stepOrder(saved)).flatMap((s) => s.paths).map((p) => <File path={p} add={12} del={2} />)}</>;
}

export function DemoPair({ k, active }: { k: string; active?: boolean }) {
  const d = DEMOS[k];
  if (!d) return null;
  return (
    <div class="demo-pair">
      <div class={active === false ? 'demo-side on' : 'demo-side'}>
        <div class="demo-label">Off</div>
        {d.off}
      </div>
      <div class={active === true ? 'demo-side on' : 'demo-side'}>
        <div class="demo-label">On</div>
        {d.on}
      </div>
    </div>
  );
}

// Scenes of the app for the README's "What it does" (#/demo/scene-<key>): made-up PRs drawn with the app's own markup.
// Made-up people get a lettered circle, never a GitHub picture (the names could be real accounts).
const face = (who: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="hsl(${[...who].reduce((h, c) => h + c.charCodeAt(0) * 37, 0) % 360} 55% 55%)"/><text x="10" y="14" font-family="system-ui" font-size="11" font-weight="600" fill="#fff" text-anchor="middle">${who[0].toUpperCase()}</text></svg>`,
  )}`;
type Item = { g: string; title: string; who: string; repo: string; when: string; layer?: string; pills: [cls: string, content: ComponentChildren][] };
const size = (a: number, d: number, f: number): [string, ComponentChildren] => ['p-size', <><b class="a">+{a}</b> <b class="d">−{d}</b> · {f} files</>];
const time = (t: string): [string, ComponentChildren] => ['p-time', <Tg i="⏱" n={t} />];
const QUEUE: [g: string, label: string, items: Item[]][] = [
  ['needs', 'Needs your review', [
    { g: 'needs', title: 'Retry failed payments with backoff', who: 'rina', repo: 'acme/shop#412', when: '20 minutes ago', pills: [['p-strong', <Tg i="again" t="re-review" />], time('~10 min'), size(84, 12, 4)] },
    { g: 'needs', title: 'Cart: keep the promo code after login', layer: '2/3', who: 'budi', repo: 'acme/shop#409', when: '2 hours ago', pills: [['p-warn', <Tg i="unsent" n={2} t="unsent comments" />], ['p-warn', <Tg i="aging" t="waiting 3 days" />], time('~25 min'), size(156, 40, 7)] },
    { g: 'needs', title: 'Move order history to the new API', who: 'sari', repo: 'acme/app#88', when: 'yesterday', pills: [['p-bad', <Tg i="ci" t="CI failing" />], ['p-bad', <Tg i="conflict" t="conflicts" />], time('~1 h'), size(610, 233, 18)] },
  ]],
  ['changes', 'You requested changes', [
    { g: 'changes', title: 'Add the refund screen', who: 'dewi', repo: 'acme/app#85', when: '3 days ago', pills: [['p-reply', <Tg i="reply" n={1} t="awaiting your reply" />], time('~30 min'), size(342, 8, 11)] },
  ]],
  ['approved', 'You approved', [
    { g: 'approved', title: 'Bump Kotlin to 2.1', who: 'eko', repo: 'acme/app#90', when: '5 hours ago', pills: [['p-warn', <Tg i="pushed" n={2} t="commits since your approval" />], ['p-ok', <Tg i="queue" n="#2" t="in merge queue" />], size(6, 6, 2)] },
  ]],
];

const SNIPPET: Row[] = [
  [' ', 30, 30, 'suspend fun charge(order: Order): Result<Receipt> {'],
  ['-', 31, '', '    return api.charge(order.id)'],
  ['+', '', 31, '    return retry(times = 3, backoff = 2.seconds) {'],
  ['+', '', 32, '        api.charge(order.id)'],
  ['+', '', 33, '    }.onFailure { e -> if (e !is IOException && attempts >= 3) log.warn("gave up: $e") }'],
  [' ', 32, 34, '}'],
];

const Thread = ({ who, when, html }: { who: string; when: string; html: string }) => (
  <tr>
    <td colSpan={3} class="notes-cell">
      <div class="notes">
        <details class="thread" open>
          <summary />
          <div class="comment">
            <img class="c-avatar" src={face(who)} alt="" /> <b>{who}</b> <time>{when}</time> <button class="copy-link">🔗</button> <span class="claude-menu"><button class="copy-link">✳</button></span>
            <div class="md" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
          <div class="editor">
            <div class="ed-bar">
              <button type="button" class="ed-tab on">Write</button>
              <button type="button" class="ed-tab">Preview</button>
              <span class="spacer" />
              {['B', 'I', '</>', '🔗', '❝', '•', '±'].map((t) => <button type="button" class="ed-tool">{t}</button>)}
            </div>
            <div class="ed-write">
              <textarea rows={2} placeholder="Reply… (⌘↵ to send)" value="Good call :+1: I'll make the backoff configurable" />
            </div>
          </div>
          <div class="row">
            <button>Resolve thread</button>
          </div>
        </details>
      </div>
    </td>
  </tr>
);

const Bar = ({ linked, menu }: { linked?: boolean; menu?: boolean }) => (
  <div class="bar">
    <button class="bar-index">⇤</button>
    <h1>
      <a><span class="pr-num">#412</span> Retry failed payments with backoff</a>
    </h1>
    <div class="bar-group">
      <a class="bar-slack">💬</a>
      <span class="claude-menu">
        <button class={linked ? 'claude-btn linked' : 'claude-btn'}>
          ✳ Claude{linked && <span class="claude-dot" />}
        </button>
        {menu && (
          <div class="account-menu claude-pop" role="menu">
            <button role="menuitem">✳ Open its Claude Code session <small>Retry payments</small></button>
            <button role="menuitem">✳ New Claude Code session <small>⌥-click</small></button>
            <button role="menuitem"><Octicon name="comment-discussion" /> Ask a question about this {T.PR} <small>no session</small></button>
          </div>
        )}
      </span>
    </div>
    <div class="bar-group bar-actions">
      <div class="submit">
        <button class="primary">Finish review</button>
      </div>
    </div>
  </div>
);

// A PR being read (the README's "Reading"), with a thread under its diff when given (the whole-window scene).
const ReviewScene = ({ thread }: { thread?: ComponentChildren }) => (
      <>
        <Bar />
        <div class="scene-main">
          <details class="ticket">
            <summary>
              <a>SHOP-231</a> <span class="jira-st js-indeterminate">In progress</span> <span class="badge">Story</span> <b>Payments survive a flaky gateway</b>
            </summary>
          </details>
          <div class="pills pr-status">
            <span class="pill"><Tg i="waiting" t="awaiting review" /></span>
            <span class="pill p-warn"><Tg i="notest" n={1} t="file without test changes" /> <span class="caret" aria-hidden="true" /></span>
            {(([c, t]) => <span class={`pill ${c}`}>{t}</span>)(size(84, 12, 4))}
          </div>
          <div class="since on">
            Showing 2 commits since your last review. <button>Show all changes</button>
          </div>
          <File path="payments/PaymentService.kt" add={3} del={1} untested>
            <Rows rows={SNIPPET} extra={thread} />
          </File>
        </div>
      </>
);

// The whole window's PR: what plain GitHub can't show you. A markdown file rendered (in lgtm's theme), its changed
// blocks marked, with a review thread inside the document; a Kotlin file with its imports folded to one line and the
// changed words picked out; pills that name the modules and the untested file.
const MdThread = ({ who, when, text }: { who: string; when: string; text: string }) => (
  <div class="comment">
    <img class="c-avatar" src={face(who)} alt="" /> <b>{who}</b> <time>{when}</time>
    <div class="md">
      <p>{text}</p>
    </div>
  </div>
);
const Showcase = () => (
  <>
    <Bar />
    <div class="pills pr-status">
      <span class="pill p-ok"><Tg i="approved" t="approved" /></span>
      <span class="pill p-warn"><Tg i="notest" n={1} t="file without test changes" /> <span class="caret" aria-hidden="true" /></span>
      <span class="pill">
        <Tg i={<ModuleIcon />} n={2} t="modules" /> <span class="caret" aria-hidden="true" />
      </span>
      {(([c, t]) => <span class={`pill ${c}`}>{t}</span>)(size(84, 12, 4))}
    </div>
    <File path="docs/payments/retries.md" add={6} del={2}>
      <div class="rich mdt mdt-lgtm">
        <div class="md chunk demo-chunk">
          <h2 data-src="1-1">Retries</h2>
          <p data-src="3-3">
            A charge that fails on the network is tried again, up to <strong>3 times</strong>, waiting longer each time.
          </p>
          <p data-src="5-5" data-chg="">
            A <strong>declined card</strong> is never retried: the customer sees the decline at once and can pick another card.
            <div class="note-host">
              <div class="notes">
                <div class="thread">
                  <MdThread who="you" when="12 minutes ago" text="Does this cover expired cards too? They come back as a different error." />
                  <MdThread who="rina" when="just now" text="Good catch, adding them to the list :+1:" />
                </div>
              </div>
            </div>
          </p>
          <table data-src="7-10" data-chg="">
            <thead>
              <tr>
                <th>Error</th>
                <th>Retried</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Network timeout</td>
                <td>✓ up to 3×</td>
              </tr>
              <tr>
                <td>Card declined</td>
                <td>Never</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </File>
    <File path="payments/src/main/kotlin/PaymentService.kt" add={3} del={1} mod=":payments" untested>
      <table class="diff">
        <tbody>
          <Fold text="⋯ +3 imports · new: kotlin.time" />
        </tbody>
      </table>
      <Rows
        rows={[
          [' ', 30, 30, '    val attempt = gateway.authorize(order)'],
          ['-', 31, '', '    return retry(times = 3) {'],
          ['+', '', 31, mark('    return retry(times = 3, retryIf = { it is IOException }) {', 'retryIf = { it is IOException }', 'wd-add')],
          [' ', 32, 32, '        api.charge(order.id)'],
        ]}
      />
    </File>
  </>
);

export const SCENES: Record<string, { title: string; width: number; body: ComponentChildren }> = {
  queue: {
    title: 'Your queue',
    width: 420,
    body: (
      <aside class="side prs">
        <div class="side-scroll">
          <div class="pr-tabs" role="tablist">
            <button role="tab" aria-selected="true">Reviewing <span class="count">5</span></button>
            <button role="tab" aria-selected="false">Your {T.PRs} <span class="count">2</span></button>
            <button role="tab" aria-selected="false">{T.Team} <span class="count">9</span></button>
          </div>
          {QUEUE.map(([g, label, items]) => (
            <details open class={`pr-group g-${g}`}>
              <summary>
                <span class="gdot" /> {label} <span class="count">{items.length}</span>
              </summary>
              {items.map((i) => (
                <a class={`pr-item g-${i.g}`}>
                  <span class="pr-title">{i.title}</span>
                  <span class="meta">
                    <img class="pr-face" src={face(i.who)} alt="" /> {i.who} · {i.layer && <b class="layer">{i.layer} </b>}
                    {i.repo} · <span class="idle">active {i.when}</span>
                  </span>
                  <span class="pills">{i.pills.map(([cls, t]) => <span class={`pill ${cls}`}>{t}</span>)}</span>
                </a>
              ))}
            </details>
          ))}
        </div>
      </aside>
    ),
  },
  review: { title: 'Reading', width: 860, body: <ReviewScene /> },
  comment: {
    title: 'Commenting',
    width: 860,
    body: (
      <File path="payments/PaymentService.kt" add={3} del={1}>
        <Rows
          rows={SNIPPET.slice(0, 5)}
          extra={<Thread who="you" when="10 minutes ago" html={md.render('Can we stop retrying on a declined card? Only network errors are worth another try.\n\n```suggestion\n    return retry(times = 3, backoff = 2.seconds, retryIf = { it is IOException }) {\n```')} />}
        />
      </File>
    ),
  },
  claude: { title: 'Claude Code', width: 860, body: <div class="scene-claude"><Bar linked menu /></div> },
  themes: {
    title: 'Themes',
    width: 760,
    body: (
      <div class="scene-themes">
        <div class="thm-grid">
          {[['lgtm', null] as const, ...Object.entries(BUILTIN_THEMES)].map(([k, t]) => (
            <span class={k === 'one' ? 'thm-card on' : 'thm-card'}>
              <ThemeThumb t={t} />
              <span class="thm-name">{t ? t.name : 'lgtm'}</span>
            </span>
          ))}
        </div>
        <div class="set-row">
          <span>
            More themes
            <small>Any of the hundreds in Zed's theme gallery, or a Zed or VS Code theme file you have.</small>
          </span>
          <span class="row">
            <button>Browse Zed themes</button>
            <button>From a file…</button>
          </span>
        </div>
      </div>
    ),
  },
  merge: {
    title: `Your ${T.PRs}`,
    width: 860,
    body: (
      <div class="merge m-wait">
        <div class="merge-head">
          <b>Waiting on requirements</b>
          <span class="merge-why">1 approving review required · 2 checks running</span>
        </div>
        <div class="merge-row">
          <button>Update branch</button>
          <select>
            <option>Squash and merge</option>
          </select>
          <button class="primary" disabled>Squash and merge</button>
          <button>Enable auto-merge</button>
        </div>
        <div class="merge-row merge-qa qa-signed">
          <Octicon name="beaker" /> QA signed off <a>Open on Slack</a>
        </div>
      </div>
    ),
  },
};

// The inbox: a thread on its code with its earlier comment folded, and a PR comment that mentions you.
SCENES.inbox = {
  title: 'Inbox',
  width: 760,
  body: (
    <div class="page history inbox">
      <h2>Waiting on your reply</h2>
      <p class="note">
        1 thread and 1 mention in 2 {T.PRs}.
        <span class="inbox-keys"><kbd>j</kbd> <kbd>k</kbd> move · <kbd>r</kbd> reply · <kbd>e</kbd> done · <kbd>x</kbd> resolve · <kbd>o</kbd> open the {T.PR}</span>
      </p>
      <section>
        <h4><a>Retry failed payments with backoff</a> <small>shop#412</small></h4>
        <div class="inbox-thread cur">
          <div class="inbox-where">
            <a>PaymentService.kt:33</a>
            <small>rina · 20 minutes ago · 2 comments</small>
          </div>
          <pre class="inbox-code">
            <div>{'suspend fun charge(order: Order): Result<Receipt> {'}</div>
            <div class="d">{'-    return api.charge(order.id)'}</div>
            <div class="a">{'+    return retry(times = 3, backoff = 2.seconds) {'}</div>
            <div class="a">{'+        api.charge(order.id)'}</div>
          </pre>
          <details class="inbox-earlier">
            <summary>1 earlier comment</summary>
          </details>
          <div class="md inbox-last"><p>Made the backoff configurable. Does 2 seconds still look right to you?</p></div>
          <textarea rows={2} placeholder="Reply to @rina" />
          <div class="row">
            <button>Done</button>
            <button>Resolve</button>
            <button class="primary" disabled>Reply</button>
          </div>
        </div>
      </section>
      <section>
        <h4><a>Add the refund screen</a> <small>app#85</small></h4>
        <div class="inbox-thread">
          <div class="inbox-where">
            <a>mentioned you</a>
            <small>dewi · 1 hour ago</small>
          </div>
          <div class="md inbox-last"><p><a>@you</a> can refunds over the daily limit go through, or should the screen stop them?</p></div>
          <textarea rows={2} placeholder={`Reply to @dewi on the ${T.PR}`} />
          <div class="row">
            <button>Done</button>
            <button class="primary" disabled>Reply</button>
          </div>
        </div>
      </section>
    </div>
  ),
};

// Review mode: only the PR, the queue's place in the bar, and the submit panel saying what goes out.
SCENES.reviewmode = {
  title: 'Review mode',
  width: 860,
  body: (
    <div class="scene-rm">
      <nav class="top">
        <b class="rm-title">Review mode</b>
        <span class="rm-count">2 of 5</span>
        <span class="spacer" />
        <button>Skip <kbd>N</kbd></button>
        <button>Exit <kbd>Esc</kbd></button>
      </nav>
      <div class="bar">
        <button class="bar-index">⇤</button>
        <h1>
          <a><span class="pr-num">#412</span> Retry failed payments with backoff</a>
        </h1>
        <div class="bar-group bar-actions">
          <div class="submit">
            <button class="primary" aria-expanded="true">Finish review <span class="caret" aria-hidden="true" /></button>
            <div class="panel">
              <textarea rows={4}>{'Please address my comments:\n\n- Keep the attempts configurable (RetryPolicy.kt:18)\n- A declined card shouldn\'t be retried (PaymentService.kt:33)'}</textarea>
              <label><input type="radio" name="ev" /> Comment</label>
              <label><input type="radio" name="ev" /> Approve</label>
              <label><input type="radio" name="ev" checked /> Request changes</label>
              <label><input type="checkbox" checked /> Message @rina on Slack</label>
              <div class="sends">
                Sends a change request with your summary; messages @rina on Slack.
              </div>
              <button class="primary">Submit review</button>
            </div>
          </div>
        </div>
      </div>
      <div class="scene-main">
        <File path="payments/PaymentService.kt" add={3} del={1}>
          <Rows rows={SNIPPET} />
        </File>
      </div>
    </div>
  ),
};

// Specs and code: a spec's names of the PR's code are links, one previewing its change; the code file links back.
const PEEK: Row[] = [
  [' ', 16, 16, 'class RetryPolicy('],
  [' ', 17, 17, '    val backoff: Duration = 2.seconds,'],
  ['+', '', 18, '    val attempts: Int = 3,'],
  ['+', '', 19, '    val retryIf: (Throwable) -> Boolean = { it is IOException },'],
  [' ', 18, 20, ')'],
];
SCENES.specs = {
  title: 'Specs and code',
  width: 860,
  body: (
    <div class="scene-specs">
      <File path="openspec/changes/retries/tasks.md" st="added" add={9} del={0}>
        <div class="rich mdt mdt-lgtm">
          <div class="md chunk demo-chunk">
            <h2>2. Retries</h2>
            <ul>
              <li>
                [x] 2.1 Add <code class="spec-ref">RetryPolicy</code> with the attempts and the errors to retry
                <span class="spec-touch">1 file in this {T.PR}</span>
              </li>
              <li>
                [ ] 2.2 Call it from <code class="spec-ref">PaymentService.charge()</code>; a declined card is never retried
                <span class="spec-touch">1 file in this {T.PR}</span>
              </li>
            </ul>
          </div>
        </div>
        <div class="spec-peek scene-peek">
          <div class="spec-peek-h">
            <b>RetryPolicy.kt</b>:18 <small>payments</small>
          </div>
          <Rows rows={PEEK} />
        </div>
      </File>
      <File
        path="payments/RetryPolicy.kt"
        st="added"
        add={12}
        del={0}
        chips={
          <button class="spec-chip">
            <Octicon name="file" /> tasks.md 2.1
          </button>
        }
      />
    </div>
  ),
};

// Android strings as texts: names, the text as the app shows it, the changed words, a placeholder, other languages.
const sx = (raw: string, kind?: '-' | '+', other?: string, notes?: string[]) => {
  const s = parseString(raw)!;
  const r = other != null ? changedRange(kind === '-' ? s.value : parseString(other)!.value, kind === '-' ? parseString(other)!.value : s.value) : null;
  return stringHtml({ ...s, lead: '' }, r ? (kind === '-' ? r[0] : r[1]) : undefined, notes);
};
const OTP_OLD = '<string name="otp_sent">We sent a code to %1$s.</string>';
const OTP_NEW = '<string name="otp_sent">We sent a 6-digit code to %1$s.</string>';
SCENES.strings = {
  title: 'Android strings',
  width: 860,
  body: (
    <File path="app/src/main/res/values/strings.xml" add={2} del={1}>
      <Rows
        rows={[
          [' ', 12, 12, sx('<string name="otp_title">Verify it\\\'s you</string>')],
          ['-', 13, '', sx(OTP_OLD, '-', OTP_NEW)],
          ['+', '', 13, sx(OTP_NEW, '+', OTP_OLD, ['values-in not updated'])],
          ['+', '', 14, sx('<string name="otp_resend">Didn\\\'t get it?\\nResend in %1$d s</string>', '+', undefined, ['missing in values-in'])],
          [' ', 14, 15, sx('<string name="otp_help" translatable="false">help@acme.example</string>')],
        ]}
      />
    </File>
  ),
};

// Settings → Checks and → Android, previewed. Here, below `sx`, which the strings ones use.
const pills = (...ps: [cls: string, content: ComponentChildren][]) => (
  <div class="pills pr-status">
    {ps.map(([cls, c]) => (
      <span class={`pill ${cls}`}>{c}</span>
    ))}
  </div>
);
// XML (or any non-Kotlin) lines as rows, escaped.
const xmlRows = (lines: string[], kind: '+' | '-' | ' ' = '+', from = 1, cls?: (i: number) => string | undefined): Row[] =>
  lines.map((l, i) => [kind, kind === '+' ? '' : from + i, kind === '-' ? '' : from + i, `<span>${md.utils.escapeHtml(l) || ' '}</span>`, cls?.(i)] as Row);
const KEY_ROWS = (cls?: string): Row[] => [
  [' ', 11, 11, 'object Payments {'],
  ['+', '', 12, '    val awsKey = "AKIAIOSFODNN7EXAMPLE"', cls],
  [' ', 12, 13, '}'],
];
const TEXT_ROWS = (cls?: string): Row[] => [
  [' ', 40, 40, 'Column {'],
  ['+', '', 41, '    Text("Pindah ke BukuAgen")', cls],
  ['+', '', 42, '    Text(stringResource(R.string.cta))'],
  [' ', 41, 43, '}'],
];
const ENTITY_ROWS: Row[] = [
  [' ', 3, 3, '@Entity(tableName = "card")'],
  [' ', 4, 4, 'data class CardEntity('],
  [' ', 5, 5, '    @PrimaryKey val id: String,'],
  ['+', '', 6, '    val nickname: String?,'],
  [' ', 6, 7, ')'],
];
const MANIFEST = ['<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />', '<receiver android:name=".sync.BootReceiver">', '    <intent-filter>', '        <action android:name="android.intent.action.BOOT_COMPLETED" />', '    </intent-filter>', '</receiver>'];
const BASELINE = ['<issue', '    id="MissingPermission"', '    message="Call requires permission which may be rejected by user">', '    <location file="src/main/java/acme/BtScanner.kt" line="42"/>', '</issue>'];
const FILES_BIG = ['openspec/changes/checkout/design.md', 'app/build.gradle.kts', 'app/src/main/java/acme/model/Order.kt', 'app/src/main/java/acme/CheckoutViewModel.kt', 'app/src/test/java/acme/CheckoutViewModelTest.kt'];
const READING = [...FILES_BIG, 'app/src/test/java/acme/CheckoutFlowTest.kt'];

Object.assign(DEMOS, {
  checkSecrets: {
    title: 'Possible secrets',
    off: <File path="Payments.kt" add={1} del={0}><Rows rows={KEY_ROWS()} /></File>,
    on: (
      <>
        {pills(['p-bad', <Tg i="key" n={1} t="possible secret" />])}
        <File path="Payments.kt" add={1} del={0}><Rows rows={KEY_ROWS('secret')} /></File>
      </>
    ),
  },
  checkDeps: {
    title: 'Dependency changes',
    off: pills(['p-size', <><b class="a">+12</b> <b class="d">−3</b> · 2 files</>]),
    on: (
      <>
        {pills(['p-warn', <Tg i="package" n={3} t="dependencies changed" />], ['p-size', <><b class="a">+12</b> <b class="d">−3</b> · 2 files</>])}
        <div class="pill-pop demo-pop">
          <p class="pill-head">Libraries added, removed or moved to another version (major jumps and versions not pinned marked):</p>
          <div class="pill-row"><button><b>com.squareup.okhttp3:okhttp</b> <small class="dep-major">4.12.0 → 5.0.0 · major</small></button></div>
          <div class="pill-row"><button><b>libs.mockk</b> <small>added · for tests</small></button></div>
          <div class="pill-row"><button><b>com.mixpanel.android:mixpanel-android</b> <small>added 7.+</small> <small class="dep-major">not pinned · dynamic, the newest that matches</small></button></div>
        </div>
      </>
    ),
  },
  checkBinaries: {
    title: 'Binary files: what they are',
    off: (
      <File path="app/src/main/assets/fw_v3.06.bin" st="added" add={0} del={0}>
        <p class="note pad">No diff to show (binary, too large, or renamed without changes). <a>View on GitHub</a></p>
      </File>
    ),
    on: (
      <File path="app/src/main/assets/fw_v3.06.bin" st="added" add={0} del={0}>
        <div class="bin-info">
          <p><Octicon name="file" /> Firmware or raw binary · <b>2.4 MB</b> · packed into the app <a>View on GitHub</a></p>
          <p class="bin-warn"><Octicon name="alert" /> Over 1 MB, straight in Git: every clone downloads it, and every version of it, for good.</p>
        </div>
      </File>
    ),
  },
  flagUntested: {
    title: 'Code changed without test changes',
    off: <File path="CheckoutViewModel.kt" add={36} del={4} />,
    on: (
      <>
        {pills(['p-warn', <Tg i="notest" n={1} t="file without test changes" />])}
        <File path="CheckoutViewModel.kt" add={36} del={4} untested />
      </>
    ),
  },
  readingOrder: {
    title: 'Files in reading order',
    off: <>{[...READING].sort().map((p) => <File path={p} add={12} del={2} />)}</>,
    on: <ReadingOrderOn />,
  },
  reviewPlan: {
    title: `A review plan for big ${T.PRs}`,
    off: <>{FILES_BIG.slice(0, 3).map((p) => <File path={p} add={12} del={2} />)}</>,
    on: (
      <details class="plan" open>
        <summary><b>Review plan</b> · 64 files in 4 steps · 9/64 viewed</summary>
        <ol>
          {([['specs', 'Specs and docs', 'what the change is meant to do', 4, 4], ['build', 'Build and config', 'dependencies, permissions, settings', 5, 3], ['code', 'Implementation', 'the change itself', 38, 2], ['tests', 'Tests', 'what it promises', 17, 0]] as const).map(([k, t, why, n, seen]) => (
            <li class={seen === n ? 'done' : ''}>
              <span class="plan-t"><Octicon name={stepIcon(k)} /> <b>{t}</b> <small>{why}</small></span>
              <span class="plan-bar"><i style={{ width: `${(100 * seen) / n}%` }} /></span>
              <small class="plan-n">{seen}/{n}</small>
              {seen === n ? <span class="plan-ok"><Octicon name="check" /></span> : <button class="link">{seen ? 'Continue' : 'Start'}</button>}
            </li>
          ))}
        </ol>
      </details>
    ),
  },
  checkHardcoded: {
    title: 'UI text not in strings.xml',
    off: <File path="MigrationDrawer.kt" add={2} del={0}><Rows rows={TEXT_ROWS()} /></File>,
    on: (
      <>
        {pills(['p-warn', <Tg i="text" n={1} t="text not in strings.xml" />])}
        <File path="MigrationDrawer.kt" add={2} del={0}><Rows rows={TEXT_ROWS('hardcoded')} /></File>
      </>
    ),
  },
  checkRoom: {
    title: 'Room tables changed without a version bump',
    off: <File path="CardEntity.kt" add={1} del={0}><Rows rows={ENTITY_ROWS} /></File>,
    on: (
      <>
        {pills(['p-bad', <Tg i="alert" t="table changed, database version not raised" />])}
        <File path="CardEntity.kt" add={1} del={0}><Rows rows={ENTITY_ROWS} /></File>
      </>
    ),
  },
  manifestSummary: {
    title: 'What a manifest change means',
    off: <File path="AndroidManifest.xml" add={6} del={0}><Rows rows={xmlRows(MANIFEST, '+', 20)} /></File>,
    on: (
      <File path="AndroidManifest.xml" add={6} del={0}>
        <div class="manifest-sum">
          <p><b>Asks for</b> <code class="risky">BLUETOOTH_CONNECT</code></p>
          <p><b>New</b> receiver <code>BootReceiver</code><b class="risky"> exported (by its intent-filter)</b></p>
        </div>
        <Rows rows={xmlRows(MANIFEST, '+', 20)} />
      </File>
    ),
  },
  lintBaselines: {
    title: 'Lint baselines as suppressions',
    off: <File path="app/lint-baseline.xml" add={5} del={0}><Rows rows={xmlRows(BASELINE, '+', 88)} /></File>,
    on: (
      <File path="app/lint-baseline.xml" add={5} del={0}>
        <div class="lint-sum">
          <p class="lint-new"><Octicon name="alert" /> <b>1 new suppression</b>: warnings lint will no longer report.</p>
          <ul><li><code>MissingPermission</code> <a>BtScanner.kt:42</a> <span class="lint-msg">Call requires permission which may be rejected by user</span></li></ul>
        </div>
      </File>
    ),
  },
  stringsView: {
    title: 'strings.xml as names and texts',
    off: <File path="res/values/strings.xml" add={1} del={1}><Rows rows={[...xmlRows([OTP_OLD], '-', 13), ...xmlRows([OTP_NEW], '+', 13)]} /></File>,
    on: (
      <File path="res/values/strings.xml" add={1} del={1}>
        <Rows rows={[['-', 13, '', sx(OTP_OLD, '-', OTP_NEW)], ['+', '', 13, sx(OTP_NEW, '+', OTP_OLD)]]} />
      </File>
    ),
  },
  translationChecks: {
    title: 'Check the other languages',
    off: <File path="res/values/strings.xml" add={1} del={1}><Rows rows={[['+', '', 13, sx(OTP_NEW, '+', OTP_OLD)]]} /></File>,
    on: <File path="res/values/strings.xml" add={1} del={1}><Rows rows={[['+', '', 13, sx(OTP_NEW, '+', OTP_OLD, ['values-in not updated'])]]} /></File>,
  },
} satisfies Record<string, Demo>);

// Settings → Diff and → Reviewing, previewed (the ones made before every switch had to have one).
const NESTED: Row[] = [
  [' ', 40, 40, '            if (paid) {'],
  ['-', 41, '', '                notify(owner)'],
  ['+', '', 41, '                notify(owner, PUSH)'],
  [' ', 42, 42, '            }'],
];
const dedent = (rows: Row[], n: number) => rows.map(([k, o, w, c, cls]) => [k, o, w, c.slice(n), cls] as Row);
const ONE_NUM = (rows: Row[]) => (
  <table class="diff one-num">
    <tbody>
      {rows.map(([k, o, n, code]) => (
        <tr class={`ln${k === '+' ? ' a' : k === '-' ? ' d' : ''}`}>
          <td class="num">{o}</td>
          <td class="num" data-old={n === '' ? o : undefined}>{n}</td>
          <td class="code" dangerouslySetInnerHTML={{ __html: kt(code) }} />
        </tr>
      ))}
    </tbody>
  </table>
);
const half = (n: number | '', code: string | null, k: '' | 'a' | 'd') => (
  <>
    <span class={code == null ? 'num none' : 'num'}>{code == null ? '' : n}</span>
    <span class={`code${code == null ? ' none' : k ? ' ' + k : ''}`} dangerouslySetInnerHTML={{ __html: code == null ? '' : kt(code) }} />
  </>
);
const BRACKETS = 'val total = items.filter { (it.qty > 0) }.sumOf { (it.price * it.qty) }';
const LINE_COMMENT = ['// Retries a failed charge up to three times, waiting', '// longer each time, so a short outage doesn\'t fail the order.', 'suspend fun charge(order: Order) = retry(times = 3) {'];
const proseRow = (n: number, html: string): Row => ['+', '', n, `<div class="doc-render" style="width: calc(100% - 3ch)"><div class="md">${html}</div></div>`];
const footer = (name: string) => (
  <footer class="file-f">
    <span class="file-f-name">{name}</span>
    <button class="icon-btn" title="Comment on this file" aria-label="Comment on this file"><Octicon name="comment" /></button>
    <label class="viewed-box"><Octicon name="eye" /></label>
  </footer>
);
const form = (now: boolean) => (
  <div class="draft-form">
    <div class="badge">Line 42</div>
    <div class="editor"><div class="ed-write"><textarea rows={2} value="Could this use the shared retry helper?" /></div></div>
    <div class="row">
      <button class="primary">{now ? 'Comment now' : 'Add to review'}</button>
      <button>{now ? 'Add to review' : 'Comment now'}</button>
      <button>Cancel</button>
    </div>
  </div>
);
const idxThread = (file: string, who: string, cls = '') => <div class={`demo-idx ${cls}`}><b>{file}</b> <small>{who}</small></div>;

Object.assign(DEMOS, {
  oldLineNumbers: {
    title: 'Old line numbers too',
    off: <File path="OrderNotifier.kt" add={1} del={1}>{ONE_NUM(dedent(NESTED, 12))}</File>,
    on: <File path="OrderNotifier.kt" add={1} del={1}><Rows rows={dedent(NESTED, 12)} /></File>,
  },
  trimIndent: {
    title: 'Leave out the shared indentation',
    off: <File path="OrderNotifier.kt" add={1} del={1}><Rows rows={NESTED} /></File>,
    on: <File path="OrderNotifier.kt" add={1} del={1}><Rows rows={dedent(NESTED, 12)} /></File>,
  },
  splitDiff: {
    title: 'Side by side',
    off: <File path="OrderNotifier.kt" add={1} del={1}><Rows rows={dedent(NESTED, 12)} /></File>,
    on: (
      <File path="OrderNotifier.kt" add={1} del={1}>
        <table class="diff">
          <tbody>
            {([[40, 'if (paid) {', 40, 'if (paid) {', ''], [41, 'notify(owner)', 41, 'notify(owner, PUSH)', 'x'], [42, '}', 42, '}', '']] as const).map(([o, a, n, b, x]) => (
              <tr class="ln split"><td colSpan={3}><div class="split-row">{half(o, a, x ? 'd' : '')}{half(n, b, x ? 'a' : '')}</div></td></tr>
            ))}
          </tbody>
        </table>
      </File>
    ),
  },
  diffSigns: {
    title: 'Show + and − before changed lines',
    off: <div class="demo-nosigns"><File path="OrderNotifier.kt" add={1} del={1}><Rows rows={dedent(NESTED, 12)} /></File></div>,
    on: <div class="demo-signs"><File path="OrderNotifier.kt" add={1} del={1}><Rows rows={dedent(NESTED, 12)} /></File></div>,
  },
  fileFooter: {
    title: 'A bar at the end of each file',
    off: <div class="demo-nofooter"><File path="OrderNotifier.kt" add={1} del={1}><Rows rows={dedent(NESTED, 12).slice(1, 3)} />{footer('OrderNotifier.kt')}</File></div>,
    on: <div class="demo-footer"><File path="OrderNotifier.kt" add={1} del={1}><Rows rows={dedent(NESTED, 12).slice(1, 3)} />{footer('OrderNotifier.kt')}</File></div>,
  },
  rainbowBrackets: {
    title: 'Rainbow brackets',
    off: <File path="Cart.kt" add={1} del={0}><Rows rows={[['+', '', 7, BRACKETS]]} /></File>,
    on: <File path="Cart.kt" add={1} del={0}><Rows rows={[['+', '', 7, `<span>${rainbow(kt(BRACKETS))}</span>`]]} /></File>,
  },
  renderLineComments: {
    title: 'Line comments rendered too',
    off: <File path="Payments.kt" add={3} del={0}><Rows rows={LINE_COMMENT.map((l, i) => ['+', '', 30 + i, l] as Row)} /></File>,
    on: (
      <File path="Payments.kt" add={3} del={0}>
        <Rows rows={[proseRow(30, '<p>Retries a failed charge up to three times, waiting longer each time, so a short outage doesn’t fail the order.</p>'), ['+', '', 32, LINE_COMMENT[2]]]} />
      </File>
    ),
  },
  renderSingleComments: {
    title: 'Single comment lines too',
    off: <File path="Payments.kt" add={2} del={0}><Rows rows={[['+', '', 40, '// Gateway limit: 3 calls a second'], ['+', '', 41, 'private val limiter = RateLimiter(3)']]} /></File>,
    on: (
      <File path="Payments.kt" add={2} del={0}>
        <Rows rows={[['+', '', 40, '<div class="doc-render doc-one" style="width: calc(100% - 3ch)"><div class="md"><p>Gateway limit: 3 calls a second</p></div></div>'], ['+', '', 41, 'private val limiter = RateLimiter(3)']]} />
      </File>
    ),
  },
  renderEditedDocs: {
    title: 'Edited doc comments rendered too',
    off: (
      <File path="Pricing.kt" add={1} del={1}>
        <Rows rows={[[' ', 20, 20, '/**'], ['-', 21, '', ' * Sums the [Item] prices in the cart.'], ['+', '', 21, ' * Sums the [Item] prices in the cart, after discounts.'], [' ', 22, 22, ' */']]} />
      </File>
    ),
    on: (
      <File path="Pricing.kt" add={1} del={1}>
        <table class="diff"><tbody><tr class="ln doc edited"><td class="num">20</td><td class="num">20</td><td class="code"><div class="doc-render" style="width: calc(100% - 3ch)"><div class="md"><p>Sums the <code>Item</code> prices in the cart<span class="doc-chg">, after discounts</span>.</p></div></div></td></tr></tbody></table>
      </File>
    ),
  },
  strikeRemoved: {
    title: 'Strike through removed text',
    off: <div class="demo-nostrike"><File path="docs/rollout.md" add={0} del={1}><div class="md demo-md"><p>Ship behind the <code>orders_v2</code> flag.</p><div class="removed"><pre>Keep the old screen as a fallback.</pre></div></div></File></div>,
    on: <div class="demo-strike"><File path="docs/rollout.md" add={0} del={1}><div class="md demo-md"><p>Ship behind the <code>orders_v2</code> flag.</p><div class="removed"><pre>Keep the old screen as a fallback.</pre></div></div></File></div>,
  },
  gradleModules: {
    title: 'Group files by module',
    off: <>{['orders/src/main/Repo.kt', 'checkout/src/main/Screen.kt'].map((p) => <File path={p} add={8} del={2} />)}</>,
    on: (
      <>
        <File path="Repo.kt" mod=":orders" add={8} del={2} />
        <File path="Screen.kt" mod=":checkout" add={8} del={2} />
      </>
    ),
  },
  hideSettled: {
    title: 'Hide resolved and outdated threads',
    off: <div class="demo-index">{idxThread('OrderRepo.kt:42', 'you')}{idxThread('Cart.kt:7', 'rina · resolved', 'settled')}{idxThread('Api.kt:19', 'budi · outdated', 'settled')}</div>,
    on: <div class="demo-index">{idxThread('OrderRepo.kt:42', 'you')}<div class="demo-idx more">2 resolved or outdated hidden · <a>show</a></div></div>,
  },
  commentNow: {
    title: 'Post comments at once',
    off: form(false),
    on: form(true),
  },
} satisfies Record<string, Demo>);

// The last of the switches that show something: layout, the list, Jira, Slack, Glass.
const listItem = (title: string, who: string, repo: string, ps: [string, ComponentChildren][]) => (
  <a class="pr-item g-needs">
    <span class="pr-title">{title}</span>
    <span class="meta"><img class="pr-face" src={face(who)} alt="" /> {who} · {repo}</span>
    <span class="pills">{ps.map(([cls, t]) => <span class={`pill ${cls}`}>{t}</span>)}</span>
  </a>
);
const agentGroup = (g: string, label: string, items: ComponentChildren[]) => (
  <details open class={`pr-group g-${g}`}>
    <summary><span class="gdot" /> {label} <span class="count">{items.length}</span></summary>
    {items}
  </details>
);
const LIST_ONE = listItem('Retry failed payments with backoff', 'rina', 'acme/shop#412', [['p-time', <Tg i="⏱" n="~10 min" />]]);
const SHORT_FILE = <File path="OrderNotifier.kt" add={1} del={1}><Rows rows={dedent(NESTED, 12)} /></File>;
const TINY_FILE = <File path="Notify.kt" add={1} del={0}><Rows rows={[[' ', 40, 40, 'if (paid) {'], ['+', '', 41, '  ship()'], [' ', 41, 42, '}']]} /></File>;
const LONG_ROW: Row[] = [['+', '', 41, 'notify(owner, PUSH, template = Templates.ORDER_PAID, locale = owner.locale)']];
const page = (body: ComponentChildren, narrow: boolean) => <div class="demo-window"><div class={narrow ? 'demo-window-in narrow' : 'demo-window-in'}>{body}</div></div>;
const TICKET = (open: boolean) => (
  <details class="ticket" open={open}>
    <summary><a>BUKU-4120</a> <span class="jira-st js-indeterminate">In Progress</span> <span class="badge">Story</span> <b>Retry failed payments</b></summary>
    <div class="md"><p>When a charge fails on a network error, try again up to three times before showing the error.</p></div>
  </details>
);
const MERGE = (tick: boolean) => (
  <div class="demo-panel merge-confirm">
    <input value="Retry failed payments with backoff (#412)" aria-label="Commit title" />
    <div class="merge-opt"><label><input type="checkbox" checked={tick} /> Move BUKU-4120 to</label> <select><option>Done</option></select></div>
    <div class="merge-row"><button class="primary">Confirm squash and merge</button> <button>Cancel</button></div>
  </div>
);
const SUBMIT = (tick: boolean) => (
  <div class="demo-panel">
    <label><input type="radio" checked /> Approve</label>
    <label><input type="checkbox" checked={tick} /> Message @rina on Slack</label>
    <button class="primary">Submit review</button>
  </div>
);
const GLASS = (on: boolean) => (
  <div class={on ? 'demo-glass glass' : 'demo-glass demo-solid'}>
    <Rows rows={dedent(NESTED, 12)} />
    <div class="bar">
      <button>✳ Claude</button>
      <button class="primary">Finish review</button>
    </div>
  </div>
);

Object.assign(DEMOS, {
  qaRequest: {
    title: `Ask QA, on your ${T.PR}`,
    off: <div class="demo-bar"><button>Merge</button><button class="primary">Comment</button></div>,
    on: <div class="demo-bar"><button>Ask QA</button><button>Merge</button><button class="primary">Comment</button></div>,
  },
  agentsAsBots: {
    title: 'A comment that opens with 🤖',
    off: <div class="demo-list">{listItem('Retry failed payments with backoff', 'rina', 'acme/shop#412', [['p-reply', <Tg i="reply" n={1} t="awaiting your reply" />]])}</div>,
    on: <div class="demo-list">{listItem('Retry failed payments with backoff', 'rina', 'acme/shop#412', [])}</div>,
  },
  muteApproved: {
    title: `Replies on a ${T.PR} you've approved`,
    off: <div class="demo-list">{listItem('Retry failed payments with backoff', 'rina', 'acme/shop#412', [['p-ok', <Tg i="approved" t="approved" />], ['p-reply', <Tg i="reply" n={2} t="awaiting your reply" />]])}</div>,
    on: <div class="demo-list">{listItem('Retry failed payments with backoff', 'rina', 'acme/shop#412', [['p-ok', <Tg i="approved" t="approved" />]])}</div>,
  },
  agentReview: {
    title: 'Claude Code reviews first',
    off: <div class="demo-list">{agentGroup('needs', 'Needs your review', [listItem('Retry failed payments with backoff', 'rina', 'acme/shop#412', [['p-time', <Tg i="⏱" n="~10 min" />]]), listItem('Cart: keep the promo code', 'budi', 'acme/shop#409', [['p-time', <Tg i="⏱" n="~5 min" />]])])}</div>,
    on: (
      <div class="demo-list">
        {agentGroup('agents', 'Agents reviewing', [listItem('Retry failed payments with backoff', 'rina', 'acme/shop#412', [['p-claude', <Tg i="🤖" t="reviewing…" />]])])}
        {agentGroup('needs', 'Needs your review', [listItem('Cart: keep the promo code', 'budi', 'acme/shop#409', [['p-claude', <Tg i="🤖" n={3} t="findings" />], ['p-time', <Tg i="⏱" n="~5 min" />]])])}
      </div>
    ),
  },
  showDrafts: {
    title: `Other people's draft ${T.PRs}`,
    off: <div class="demo-list">{LIST_ONE}</div>,
    on: <div class="demo-list">{LIST_ONE}{listItem('Try the new checkout layout', 'budi', 'acme/shop#415', [['', <Tg i="draft" t="draft" />]])}</div>,
  },
  centerDiff: {
    title: `Centre the ${T.PR}`,
    off: page(TINY_FILE, false),
    on: page(TINY_FILE, true),
  },
  centerFit: {
    title: 'Fill the window for a wide line',
    off: page(<File path="OrderNotifier.kt" add={1} del={0}><Rows rows={LONG_ROW} /></File>, true),
    on: page(<File path="OrderNotifier.kt" add={1} del={0}><Rows rows={LONG_ROW} /></File>, false),
  },
  showIndex: {
    title: `The ${T.PR} index beside the diff`,
    off: SHORT_FILE,
    on: (
      <div class="demo-with-index">
        <div class="demo-index">
          <b>Conversation 2</b>
          <div class="demo-idx">OrderNotifier.kt:41 <small>you</small></div>
          <b>Files 2</b>
          <div class="demo-idx">OrderNotifier.kt</div>
          <div class="demo-idx">OrderNotifierTest.kt</div>
        </div>
        {SHORT_FILE}
      </div>
    ),
  },
  ticketOpen: { title: 'The Jira ticket, expanded', off: TICKET(false), on: TICKET(true) },
  jiraOnMerge: { title: 'Move the Jira ticket when you merge', off: MERGE(false), on: MERGE(true) },
  slackNotify: { title: 'Message on Slack after a review', off: SUBMIT(false), on: SUBMIT(true) },
  glass: { title: 'Glass', off: GLASS(false), on: GLASS(true) },
} satisfies Record<string, Demo>);

// Settings → Java backend, previewed.
const sql = (code: string) => `<span>${md.utils.escapeHtml(code)}</span>`;
const MIG_ROWS: Row[] = [['-', 1, '', sql('ALTER TABLE payments ADD fee INT;')], ['+', '', 1, sql('ALTER TABLE payments ADD fee BIGINT;')]];
const JPA_ROWS: Row[] = [[' ', 12, 12, '    private String id;'], ['+', '', 13, '    private BigDecimal fee;'], [' ', 13, 14, '    private String status;']];
const TX_ROWS: Row[] = [['+', '', 40, '    @Transactional'], ['+', '', 41, '    private void settle(Payment p) {']];
Object.assign(DEMOS, {
  checkMigrations: {
    title: 'Flyway migrations edited or out of order',
    off: <File path="db/migration/V20250201__fee.sql" add={1} del={1}><Rows rows={MIG_ROWS} /></File>,
    on: (
      <>
        {pills(['p-bad', <Tg i="alert" n={1} t="migration problem" />])}
        <File path="db/migration/V20250201__fee.sql" add={1} del={1}><Rows rows={MIG_ROWS} /></File>
      </>
    ),
  },
  checkJpa: {
    title: 'JPA entities changed with no migration',
    off: <File path="PaymentEntity.java" add={1} del={0}><Rows rows={JPA_ROWS} /></File>,
    on: (
      <>
        {pills(['p-warn', <Tg i="alert" t="entity changed, no migration" />])}
        <File path="PaymentEntity.java" add={1} del={0}><Rows rows={JPA_ROWS} /></File>
      </>
    ),
  },
  checkTransactional: {
    title: '@Transactional on a private method',
    off: <File path="PaymentService.java" add={2} del={0}><Rows rows={TX_ROWS} /></File>,
    on: (
      <>
        {pills(['p-warn', <Tg i="alert" n={1} t="@Transactional on a private method" />])}
        <File path="PaymentService.java" add={2} del={0}><Rows rows={TX_ROWS} /></File>
      </>
    ),
  },
} satisfies Record<string, Demo>);

// Settings → Web, previewed.
const ts = (code: string) => highlightCode(code, 'typescript');
const tsRows = (rows: [k: '+' | ' ', n: number, code: string][]): Row[] => rows.map(([k, n, c]) => [k, k === '+' ? '' : n, n, `<span>${ts(c)}</span>`] as Row);
const PKG_ROWS: Row[] = [['-', 12, '', sql('    "vue": "^3.4.0",')], ['+', '', 12, sql('    "vue": "^3.5.0",')]];
const ONLY_ROWS = tsRows([['+', 8, "describe.only('cart', () => {"], ['+', 9, "  it('adds an item', () => {"]]);
const HTML_ROWS: Row[] = [['+', '', 21, sql('<div class="note" v-html="order.note"></div>')]];
const SUPP_ROWS = tsRows([['+', 30, '// @ts-ignore'], ['+', 31, 'const total = cart.items.reduce(sum)']]);
const MINIFY_ROWS: Row[] = [[' ', 23, 23, `<span>${kt('        release {')}</span>`], ['-', 24, '', `<span>${kt('            isMinifyEnabled = true')}</span>`], ['+', '', 24, `<span>${kt('            isMinifyEnabled = false')}</span>`]];
const IGNORE_ROWS: Row[] = [[' ', 14, 14, `<span>${kt('    @Test')}</span>`], ['+', '', 15, `<span>${kt('    @Ignore("flaky on CI")')}</span>`], [' ', 15, 16, `<span>${kt('    fun appliesPromoCode() {')}</span>`]];
Object.assign(DEMOS, {
  checkLockfile: {
    title: 'Lockfile not updated',
    off: <File path="package.json" add={1} del={1}><Rows rows={PKG_ROWS} /></File>,
    on: <>{pills(['p-bad', <Tg i="package" t="lockfile not updated" />])}<File path="package.json" add={1} del={1}><Rows rows={PKG_ROWS} /></File></>,
  },
  checkFocused: {
    title: 'Focused tests and debugger left in',
    off: <File path="cart.test.ts" add={2} del={0}><Rows rows={ONLY_ROWS} /></File>,
    on: <>{pills(['p-bad', <Tg i="alert" n={1} t="focused test left in" />])}<File path="cart.test.ts" add={2} del={0}><Rows rows={ONLY_ROWS} /></File></>,
  },
  checkRawHtml: {
    title: 'Raw HTML rendering',
    off: <File path="OrderNote.vue" add={1} del={0}><Rows rows={HTML_ROWS} /></File>,
    on: <>{pills(['p-warn', <Tg i="alert" n={1} t="raw HTML" />])}<File path="OrderNote.vue" add={1} del={0}><Rows rows={HTML_ROWS} /></File></>,
  },
  checkSuppressions: {
    title: 'Tests, CI and checks switched off',
    off: <><File path="cart.ts" add={2} del={0}><Rows rows={SUPP_ROWS} /></File><File path="CartTest.kt" add={1} del={0}><Rows rows={IGNORE_ROWS} /></File></>,
    on: (
      <>
        {pills(['p-warn', <Tg i="alert" n={2} t="tests and checks switched off" />])}
        <File path="cart.ts" add={2} del={0}><Rows rows={SUPP_ROWS} /></File>
        <File path="CartTest.kt" add={1} del={0}><Rows rows={IGNORE_ROWS} /></File>
      </>
    ),
  },
  checkProtections: {
    title: 'Protections switched off',
    off: <File path="app/build.gradle.kts" add={1} del={1}><Rows rows={MINIFY_ROWS} /></File>,
    on: (
      <>
        {pills(['p-bad', <Tg i="alert" n={1} t="protection switched off" />])}
        <div class="pill-pop demo-pop">
          <p class="pill-head">Safeguards the {T.PR} turns off:</p>
          <div class="pill-row"><button><b>isMinifyEnabled = false</b> <small>build.gradle.kts:24</small> <small>Release builds ship unshrunk and unobfuscated: anyone can read the code back from the app.</small></button></div>
        </div>
        <File path="app/build.gradle.kts" add={1} del={1}><Rows rows={MINIFY_ROWS} /></File>
      </>
    ),
  },
} satisfies Record<string, Demo>);

Object.assign(DEMOS, {
  themeColors: {
    title: "Theme colours for lgtm's marks (here with Gruvbox)",
    off: <ThemeMarks on={false} />,
    on: <ThemeMarks on />,
  },
  relativeTimes: {
    title: 'Relative times',
    off: <div class="conversation"><div class="comment"><img class="c-avatar" src={face('budi')} alt="" /> <b>budi</b> <time>5 Nov 2026, 14:31</time><div class="md"><p>Looks good, one question on the retry.</p></div></div></div>,
    on: <div class="conversation"><div class="comment"><img class="c-avatar" src={face('budi')} alt="" /> <b>budi</b> <time>2 hours ago</time><div class="md"><p>Looks good, one question on the retry.</p></div></div></div>,
  },
} satisfies Record<string, Demo>);

// lgtm's marks under a theme (Gruvbox): its colours (on), or lgtm's own (off).
function ThemeMarks({ on }: { on: boolean }) {
  return (
    <div class="demo-theme" style={{ ...themeStyle(BUILTIN_THEMES.gruvbox), ...(on ? markProps(BUILTIN_THEMES.gruvbox) : {}) }}>
      <p><span class="ph ph-given">Given</span> a saved card <span class="ph ph-when">When</span> it expires <span class="ph ph-then">Then</span> retry</p>
      <p><b>okhttp</b> <small class="dep-major">4.12.0 → 5.0.0 · major</small> · <span class="ix-status away">🌴 On leave</span></p>
      <p><span class="state-chip merged"><Octicon name="git-merge" /> Merged</span> keeps lgtm's colours</p>
    </div>
  );
}

// Settings → App → Mac app: the menu bar item, and its menu.
const MACBAR = (on: boolean) => (
  <div class="demo-macbar">
    <div class="demo-macbar-strip">
      {on && <span class="demo-tray on"><img src="./tray-template.png" alt="" /> 2</span>}
      <span>Wi-Fi</span> <span>Tue 14:05</span>
    </div>
    {on && (
      <div class="demo-traymenu">
        <div class="h">Needs your review (2)</div>
        <div>Retry failed payments · shop#412</div>
        <div>Cart: keep the promo code · shop#409</div>
        <hr />
        <div class="h">Your {T.PRs} (1)</div>
        <div>Refund screen · app#85 — ready to merge</div>
        <hr />
        <div>Start Review Mode</div>
        <div>Open lgtm</div>
      </div>
    )}
  </div>
);
Object.assign(DEMOS, { menuBar: { title: 'In the menu bar', off: MACBAR(false), on: MACBAR(true) } } satisfies Record<string, Demo>);
// The Dock icon's badge: 2 PRs to review, then those and 3 threads waiting on your reply.
const DOCK = (n: number, inbox: boolean) => (
  <div class="demo-dock">
    <span class="demo-dock-icon">lgtm<b>{n}</b></span>
    <small>2 to review{inbox ? ' + 3 waiting on your reply' : ''}</small>
  </div>
);
DEMOS.badgeInbox = { title: 'The Dock badge', off: DOCK(2, false), on: DOCK(5, true) };
// A PR waiting for your review, opened: with the index, or without it (the showIndex scenes, the other way round).
// Finish review's panel, with "then the next PR" ticked or not.
const NEXT_PANEL = (next: boolean) => (
  <div class="submit review-submit">
    <div class="panel" style={{ position: 'static' }}>
      <label><input type="checkbox" checked={next} disabled /> Then open the next {T.PR} that needs my review</label>
      <div class="row"><button class="primary">Submit review</button></div>
    </div>
  </div>
);
DEMOS.nextAfterReview = { title: `After a review, the next ${T.PR}`, off: NEXT_PANEL(false), on: NEXT_PANEL(true) };
DEMOS.unfoldBotsOnMine = { title: `Bot comments on your own ${T.PR}`, off: DEMOS.foldBots.on, on: DEMOS.foldBots.off };
DEMOS.hideIndexToReview = { title: `A ${T.PR} waiting for your review, opened`, off: DEMOS.showIndex.on, on: DEMOS.showIndex.off };

// The whole window: top bar, PR list, the PR's index, and the PR (the README's first picture). After the others, which
// it's made of.
SCENES.app = {
    title: 'lgtm',
    width: 1400,
    body: (
      <div class="scene-app">
        <nav class="top">
          <button><Octicon name="three-bars" /></button>
          <a class="nav-btn"><Octicon name="gear" /></a>
          <div class="top-actions">
            <button><span><Octicon name="sync" /></span></button>
            <button><Octicon name="bell" /></button>
          </div>
          <span class="spacer" />
          <span class="nav-go">
            <button class="nav-hist"><Octicon name="arrow-left" /></button>
            <button class="nav-hist"><Octicon name="arrow-right" /></button>
            <div class="cmd">
              <svg class="cmd-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6" />
                <path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              </svg>
              <kbd class="cmd-kbd">⌘K</kbd>
              <input placeholder={`Go to a ${T.PR}, file or thread, or paste a ${T.PR} link`} />
            </div>
          </span>
          <span class="spacer" />
          <button>?</button>
          <button class="theme-btn">◐</button>
          <span class="scene-avatar">Y</span>
        </nav>
        <div class="scene-app-body">
          {SCENES.queue.body}
          <aside class="side">
            <div class="index">
              <details open class="ix-sec">
                <summary>Reviewers <span class="count">2</span></summary>
                <button class="ix-item ix-person"><span class="ix-label"><img src={face('budi')} alt="" />budi <span class="ix-meta v-APPROVED"><Tg i="approved" t="approved" /></span></span></button>
                <button class="ix-item ix-person"><span class="ix-label"><img src={face('you')} alt="" />you <span class="ix-meta v-WAITING"><Tg i="waiting" t="waiting" /></span></span></button>
              </details>
              <details open class="ix-sec">
                <summary>Conversation <span class="count">3</span></summary>
                <button class="ix-item"><span class="ix-label">Description</span></button>
                <details open class="ix-ckgroup">
                  <summary><Octicon name="person" /> 1 yours</summary>
                  <button class="ix-item"><span class="ix-label"><Octicon name="file" /> retries.md:5 <span class="ix-meta"><Who login="you" src={face('you')} /></span> <span class="ix-sub ix-inline">Does this cover expired cards too?</span></span></button>
                </details>
                <details open class="ix-ckgroup">
                  <summary><Octicon name="comment-discussion" /> 1 from others</summary>
                  <button class="ix-item"><span class="ix-label"><Who login="budi" src={face('budi')} /> <span class="ix-meta"><Tg i="approved" t="approved" /></span></span><span class="ix-sub">Nice, much safer.</span></button>
                </details>
              </details>
              <details open class="ix-sec">
                <summary>Checks <span class="count">6</span></summary>
                <details class="ix-ckgroup"><summary><CheckMark state="success" /> 6 passed</summary></details>
              </details>
              <details open class="ix-sec">
                <summary>Files <span class="count">5</span> <span class="ck-sum">1/5 viewed</span></summary>
                {([
                  [':payments', 'main/kotlin', ['payments/src/main/kotlin/PaymentService.kt', 'payments/src/main/kotlin/RetryPolicy.kt']],
                  [':payments', 'test/kotlin', ['payments/src/test/kotlin/RetryPolicyTest.kt']],
                  [':app', 'main/res/values', ['app/src/main/res/values/strings.xml']],
                  ['', '', ['docs/payments/retries.md']],
                ] as [string, string, string[]][]).map(([m, dir, files], k, all) => (
                  <>
                    {m !== all[k - 1]?.[0] && (
                      <div class="tree-row">
                        <span class="tree-dir-name" style={{ paddingLeft: '8px' }}>{m ? <><ModuleIcon /> {m}</> : 'Other files'}</span>
                      </div>
                    )}
                    {dir && (
                      <div class="tree-row">
                        <span class="tree-dir-name" style={{ paddingLeft: '22px' }}>
                          <img class="dicon" src={folderIcon(dir, true)} alt="" />
                          {dir}
                        </span>
                      </div>
                    )}
                    {files.map((f) => (
                      <div class={f.endsWith('strings.xml') ? 'tree-row dim' : 'tree-row'}>
                        <button class="tree-file" style={{ paddingLeft: dir ? '36px' : '22px' }}>
                          <FileIcon path={f} status={f.endsWith('RetryPolicy.kt') || f.endsWith('Test.kt') ? 'added' : 'modified'} untested={f.endsWith('PaymentService.kt')} />
                          <span class="tree-name">{f.split('/').pop()}</span>
                        </button>
                        <span class={f.endsWith('strings.xml') ? 'vmark on' : 'vmark'}>{f.endsWith('strings.xml') ? '✓' : ''}</span>
                      </div>
                    ))}
                  </>
                ))}
              </details>
            </div>
          </aside>
          <div class="scene-app-main">
            <Showcase />
          </div>
        </div>
      </div>
    ),
  };

// #/demo/<key>[/light|/dark]: one example on its own, for the README pictures.
export function DemoPage({ k: route }: { k: string }) {
  const [k, theme] = route.split('/');
  if (theme) document.documentElement.dataset.theme = theme;
  return (
    SCENES[k.replace(/^scene-/, '')] && k.startsWith('scene-') ? (
      <div class="demo-page scene" style={{ width: SCENES[k.slice(6)].width }}>
        {SCENES[k.slice(6)].body}
      </div>
    ) : (
      <div class="demo-page">
        <h3>{DEMOS[k]?.title ?? k}</h3>
        <DemoPair k={k} />
      </div>
    )
  );
}
