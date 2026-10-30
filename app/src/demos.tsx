import type { ComponentChildren } from 'preact';
import { highlightCode, splitLines } from './highlight.ts';
import { md } from './markdown.ts';
import { FileIcon, ModuleIcon } from './shortcuts.tsx';
import { folderIcon } from './fileicons.ts';
import { CheckMark, Tg } from './tags.tsx';
import { ThemeThumb } from './themecard.tsx';
import { BUILTIN_THEMES } from './themes.ts';
import { parseDoc } from './docs.ts';

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

function File({ path, st = 'modified', add, del, mod, untested, children }: { path: string; st?: string; add: number; del: number; mod?: string; untested?: boolean; children?: ComponentChildren }) {
  return (
    <section class="file">
      <header class="file-h">
        <span class={`st s-${st}`}><Tg i={st} t={st} /></span>
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
    title: 'Fold bot comments',
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
        <details class="comment bot">
          <summary>
            <b>coverage-bot</b> <time>2 hours ago</time> <span class="bot-excerpt">{BOT_TEXT.slice(0, 60)}</span>
          </summary>
        </details>
      </div>
    ),
  },
};

// Without → with, side by side. `active`: which side the current setting gives (outlined).
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
            <button>Resolve conversation</button>
          </div>
        </details>
      </div>
    </td>
  </tr>
);

const Bar = ({ linked }: { linked?: boolean }) => (
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
            <span class="pill p-warn"><Tg i="notest" n={1} t="file without test changes" /> <span class="pill-caret">▾</span></span>
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
// blocks marked, with a review thread inside the document; a Kotlin file with its imports folded to one line, the hunk
// named by its function, and the changed words picked out; pills that name the modules and the untested file.
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
      <span class="pill p-warn"><Tg i="notest" n={1} t="file without test changes" /> <span class="pill-caret">▾</span></span>
      <span class="pill">
        <Tg i={<ModuleIcon />} n={2} t="modules" /> <span class="pill-caret">▾</span>
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
          <tr class="hunk">
            <td colSpan={3}>
              <div class="hunk-line">
                <span class="hunk-range">@@ -28,6 +28,8 @@</span> <span class="hunk-ctx">suspend fun charge(order: Order): Result&lt;Receipt&gt;</span>
              </div>
            </td>
          </tr>
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
            <button role="tab" aria-selected="false">Your PRs <span class="count">2</span></button>
            <button role="tab" aria-selected="false">Team <span class="count">9</span></button>
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
  claude: { title: 'Claude Code', width: 860, body: <Bar linked /> },
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
    title: 'Your PRs',
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
      </div>
    ),
  },
};

// The whole window: top bar, PR list, the PR's index, and the PR (the README's first picture). After the others, which
// it's made of.
SCENES.app = {
    title: 'lgtm',
    width: 1400,
    body: (
      <div class="scene-app">
        <nav class="top">
          <button>☰</button>
          <a class="nav-btn">⚙ Settings</a>
          <div class="top-actions">
            <button><span>↻</span></button>
            <button>🔔</button>
          </div>
          <span class="spacer" />
          <div class="cmd">
            <svg class="cmd-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6" />
              <path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
            <kbd class="cmd-kbd">⌘K</kbd>
            <input placeholder="Go to a PR, file or thread, or paste a PR link" />
          </div>
          <span class="spacer" />
          <button>◐ Auto</button>
          <span class="scene-avatar">Y</span>
        </nav>
        <div class="scene-app-body">
          {SCENES.queue.body}
          <aside class="side">
            <div class="index">
              <details open class="ix-sec">
                <summary>Conversation <span class="count">3</span></summary>
                <button class="ix-item"><span class="ix-label">Description <span class="ix-meta">rina</span></span></button>
                <button class="ix-item"><span class="ix-label">budi <span class="ix-meta"><Tg i="approved" t="approved" /></span></span><span class="ix-sub">Nice, much safer.</span></button>
              </details>
              <details open class="ix-sec">
                <summary>Reviewers <span class="count">2</span></summary>
                <button class="ix-item ix-person"><span class="ix-label"><img src={face('budi')} alt="" />@budi <span class="ix-meta v-APPROVED"><Tg i="approved" t="approved" /></span></span></button>
                <button class="ix-item ix-person"><span class="ix-label"><img src={face('you')} alt="" />@you <span class="ix-meta v-WAITING"><Tg i="waiting" t="waiting" /></span></span></button>
              </details>
              <details open class="ix-sec">
                <summary>Checks <span class="count">6</span></summary>
                <details class="ix-ckgroup"><summary><CheckMark state="success" /> 6 passed</summary></details>
              </details>
              <details open class="ix-sec">
                <summary>Review threads <span class="count">1</span></summary>
                <button class="ix-item"><span class="ix-label">retries.md:5 <span class="ix-meta">you</span></span><span class="ix-sub">Does this cover expired cards too?</span></button>
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
