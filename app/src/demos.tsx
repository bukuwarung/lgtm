import type { ComponentChildren } from 'preact';
import { highlightCode, splitLines } from './highlight.ts';
import { md } from './markdown.ts';
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
            <td class="code" dangerouslySetInnerHTML={{ __html: code.startsWith('<') ? code : kt(code) }} />
          </tr>
        ))}
        {extra}
      </tbody>
    </table>
  );
}

function File({ path, st = 'modified', add, del, children }: { path: string; st?: string; add: number; del: number; children?: ComponentChildren }) {
  return (
    <section class="file">
      <header class="file-h">
        <span class="st">{st}</span>
        <a>{path}</a>
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

const mark = (code: string, word: string, cls: string) => kt(code).replace(word, `<mark class="${cls}">${word}</mark>`);

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
type Item = { g: string; title: string; meta: string; layer?: string; pills: [cls: string, text: ComponentChildren][] };
const size = (a: number, d: number, f: number): [string, ComponentChildren] => ['p-size', <><b class="a">+{a}</b> <b class="d">−{d}</b> · {f} files</>];
const QUEUE: [g: string, label: string, items: Item[]][] = [
  ['needs', 'Needs your review', [
    { g: 'needs', title: 'Retry failed payments with backoff', meta: 'acme/shop#412 · rina · 20 minutes ago', pills: [['p-strong', '↻ re-review'], size(84, 12, 4)] },
    { g: 'needs', title: 'Cart: keep the promo code after login', layer: '2/3 ', meta: 'acme/shop#409 · budi · 2 hours ago', pills: [['p-warn', '2 unsent comments'], size(156, 40, 7)] },
    { g: 'needs', title: 'Move order history to the new API', meta: 'acme/app#88 · sari · yesterday', pills: [['p-bad', 'CI failing'], ['p-bad', 'conflicts'], size(610, 233, 18)] },
  ]],
  ['changes', 'You requested changes', [
    { g: 'changes', title: 'Add the refund screen', meta: 'acme/app#85 · dewi · 3 days ago', pills: [['p-reply', '💬 1 awaiting your reply'], size(342, 8, 11)] },
  ]],
  ['approved', 'You approved', [
    { g: 'approved', title: 'Bump Kotlin to 2.1', meta: 'acme/app#90 · eko · 5 hours ago', pills: [['p-ok', 'PR approved'], size(6, 6, 2)] },
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
            <b>{who}</b> <time>{when}</time> <button class="copy-link">🔗</button> <span class="claude-menu"><button class="copy-link">✳</button></span>
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
    <button>⇤ Index</button>
    <h1>
      <a><span class="pr-num">#412</span> Retry failed payments with backoff</a>
    </h1>
    <a class="bar-slack">💬 @rina</a>
    <span class="claude-menu">
      <button class={linked ? 'claude-btn linked' : 'claude-btn'}>
        ✳ Claude{linked && <span class="claude-dot" />}
      </button>
    </span>
    <div class="submit">
      <button class="primary">Finish review</button>
    </div>
  </div>
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
                    {i.layer && <b class="layer">{i.layer}</b>}
                    {i.meta}
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
  review: {
    title: 'Reading',
    width: 860,
    body: (
      <>
        <Bar />
        <div class="scene-main">
          <details class="ticket">
            <summary>
              <a>SHOP-231</a> <span class="jira-st js-indeterminate">In progress</span> <span class="badge">Story</span> <b>Payments survive a flaky gateway</b>
            </summary>
          </details>
          <div class="pills pr-status">
            <span class="pill p-strong">↻ re-review</span>
            <span class="pill p-ok">checks passing</span>
            {(([c, t]) => <span class={`pill ${c}`}>{t}</span>)(size(84, 12, 4))}
          </div>
          <div class="since on">
            Showing 2 commits since your last review. <button>Show all changes</button>
          </div>
          <File path="payments/PaymentService.kt" add={3} del={1}>
            <Rows rows={SNIPPET} />
          </File>
        </div>
      </>
    ),
  },
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
