import type { ComponentChildren } from 'preact';
import { highlightCode, splitLines } from './highlight.ts';
import { md } from './markdown.ts';
import { parseDoc } from './docs.ts';

// Small, made-up examples of each diff helper, drawn with the app's own styles: shown beside the switches in
// Settings, and captured as the README's pictures (`npm run demos`). No real code from any PR.

type Row = [kind: '+' | '-' | ' ', old: number | '', now: number | '', code: string, cls?: string];
const kt = (code: string) => highlightCode(code, 'kotlin');

function Rows({ rows }: { rows: Row[] }) {
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
  ['+', '', 8, 'class OrderRepository @Inject constructor('],
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
 * Sums the prices of the [Item]s in the cart.
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
    on: (
      <File path="docs/rollout.md" add={4} del={0}>
        <div class="md demo-md" dangerouslySetInnerHTML={{ __html: md.render(MD_SRC) }} />
      </File>
    ),
  },
  previewImages: {
    title: 'Images as pictures',
    off: (
      <File path="res/drawable/ic_orders.xml" st="added" add={9} del={0}>
        <Rows
          rows={['<vector android:width="24dp" android:height="24dp"', '    android:viewportWidth="24" android:viewportHeight="24">', '  <path android:fillColor="#92BDFF"', '      android:pathData="M4,3h16a1,1 0,0 1,1 1v16…"/>']
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

// #/demo/<key>[/light|/dark]: one example on its own, for the README pictures.
export function DemoPage({ k: route }: { k: string }) {
  const [k, theme] = route.split('/');
  if (theme) document.documentElement.dataset.theme = theme;
  return (
    <div class="demo-page">
      <h3>{DEMOS[k]?.title ?? k}</h3>
      <DemoPair k={k} />
    </div>
  );
}
