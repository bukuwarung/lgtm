// Android VectorDrawable XML → SVG, to preview res/drawable vectors in the diff. Covers vector/group/path/clip-path,
// colours, stroke and fill attributes, group transforms, and inline gradients (aapt:attr). Colour references
// (@color/…, ?attr/…) can't be resolved here and are drawn grey. The SVG goes into an <img>, so nothing in it runs.
type El = { tag: string; attrs: Record<string, string>; kids: El[] };

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// Just enough XML for drawables: elements and quoted attributes; comments, prolog and text are skipped.
function parse(xml: string): El | null {
  const root: El = { tag: '#root', attrs: {}, kids: [] };
  const stack = [root];
  const src = xml.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, '');
  for (const m of src.matchAll(/<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g)) {
    const [, close, tag, rawAttrs, selfClose] = m;
    if (close) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unescape(a[2] ?? a[3]);
    const el: El = { tag, attrs, kids: [] };
    stack.at(-1)!.kids.push(el);
    if (!selfClose) stack.push(el);
  }
  return root.kids[0] ?? null;
}

// #RGB, #ARGB, #RRGGBB, #AARRGGBB → CSS; anything else (a resource reference) → null.
function color(v: string | undefined): string | null {
  const h = v?.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (!h || ![3, 4, 6, 8].includes(h.length)) return null;
  const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h;
  const [a, rgb] = full.length === 8 ? [parseInt(full.slice(0, 2), 16) / 255, full.slice(2)] : [1, full];
  return a === 1 ? `#${rgb}` : `rgba(${parseInt(rgb.slice(0, 2), 16)},${parseInt(rgb.slice(2, 4), 16)},${parseInt(rgb.slice(4, 6), 16)},${+a.toFixed(3)})`;
}

const num = (v: string | undefined, d = 0) => (v == null || isNaN(parseFloat(v)) ? d : parseFloat(v));

export type VectorSvg = { svg: string; width: number; height: number; approx: boolean };

export function vectorToSvg(xml: string): VectorSvg | null {
  const root = parse(xml);
  if (root?.tag !== 'vector') return null;
  const a = (el: El, k: string) => el.attrs['android:' + k];
  let approx = false;
  let ids = 0;
  const defs: string[] = [];

  // A paint attribute: a colour, a resource (grey, flagged approximate), or an inline <aapt:attr> gradient.
  const paint = (el: El, k: string): string | null => {
    const inline = el.kids.find((c) => c.tag === 'aapt:attr' && c.attrs.name === 'android:' + k)?.kids.find((c) => c.tag === 'gradient');
    if (inline) return gradient(inline);
    const v = a(el, k);
    if (v == null) return null;
    const c = color(v);
    if (c == null) approx = true;
    return c ?? '#9e9e9e';
  };
  const gradient = (g: El): string => {
    const id = `g${++ids}`;
    const items = g.kids.filter((c) => c.tag === 'item');
    const stops = items.length
      ? items.map((i) => [num(a(i, 'offset')), a(i, 'color')] as const)
      : ([[0, a(g, 'startColor')], ...(a(g, 'centerColor') ? [[0.5, a(g, 'centerColor')] as const] : []), [1, a(g, 'endColor')]] as const);
    const stopXml = stops.map(([o, c]) => `<stop offset="${o}" stop-color="${esc(color(c) ?? '#9e9e9e')}"/>`).join('');
    if (a(g, 'type') === 'radial')
      defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(a(g, 'centerX'))}" cy="${num(a(g, 'centerY'))}" r="${num(a(g, 'gradientRadius'))}">${stopXml}</radialGradient>`);
    else if (a(g, 'type') === 'sweep') return color(stops[0][1]) ?? '#9e9e9e'; // ponytail: sweep shown as its first colour
    else
      defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(a(g, 'startX'))}" y1="${num(a(g, 'startY'))}" x2="${num(a(g, 'endX'))}" y2="${num(a(g, 'endY'))}">${stopXml}</linearGradient>`);
    return `url(#${id})`;
  };

  const path = (el: El) => {
    const d = a(el, 'pathData');
    if (!d) return '';
    const fill = paint(el, 'fillColor') ?? 'none';
    const stroke = paint(el, 'strokeColor');
    const attrs = [
      `d="${esc(d)}"`,
      `fill="${esc(fill)}"`,
      a(el, 'fillAlpha') && `fill-opacity="${num(a(el, 'fillAlpha'), 1)}"`,
      a(el, 'fillType') === 'evenOdd' && 'fill-rule="evenodd"',
      stroke && `stroke="${esc(stroke)}" stroke-width="${num(a(el, 'strokeWidth'), 0)}"`,
      stroke && a(el, 'strokeAlpha') && `stroke-opacity="${num(a(el, 'strokeAlpha'), 1)}"`,
      stroke && a(el, 'strokeLineCap') && `stroke-linecap="${esc(a(el, 'strokeLineCap')!)}"`,
      stroke && a(el, 'strokeLineJoin') && `stroke-linejoin="${esc(a(el, 'strokeLineJoin')!)}"`,
      stroke && a(el, 'strokeMiterLimit') && `stroke-miterlimit="${num(a(el, 'strokeMiterLimit'), 4)}"`,
    ];
    return `<path ${attrs.filter(Boolean).join(' ')}/>`;
  };

  // Children in order; a <clip-path> clips the siblings after it (Android semantics), so the rest nests inside it.
  const children = (kids: El[]): string => {
    const i = kids.findIndex((k) => k.tag === 'clip-path' && a(k, 'pathData'));
    let out = (i < 0 ? kids : kids.slice(0, i)).map((k) => (k.tag === 'path' ? path(k) : k.tag === 'group' ? group(k) : '')).join('');
    if (i >= 0) {
      const id = `c${++ids}`;
      defs.push(`<clipPath id="${id}"><path d="${esc(a(kids[i], 'pathData')!)}"/></clipPath>`);
      out += `<g clip-path="url(#${id})">${children(kids.slice(i + 1))}</g>`;
    }
    return out;
  };
  const group = (g: El) => {
    const px = num(a(g, 'pivotX')), py = num(a(g, 'pivotY'));
    const t = `translate(${num(a(g, 'translateX')) + px} ${num(a(g, 'translateY')) + py}) rotate(${num(a(g, 'rotation'))}) scale(${num(a(g, 'scaleX'), 1)} ${num(a(g, 'scaleY'), 1)}) translate(${-px} ${-py})`;
    return `<g transform="${t}">${children(g.kids)}</g>`;
  };

  const vw = num(a(root, 'viewportWidth'), 24), vh = num(a(root, 'viewportHeight'), 24);
  const width = num(a(root, 'width'), vw), height = num(a(root, 'height'), vh);
  const body = children(root.kids);
  const alpha = a(root, 'alpha') ? ` opacity="${num(a(root, 'alpha'), 1)}"` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="${width}" height="${height}"${alpha}><defs>${defs.join('')}</defs>${body}</svg>`;
  return { svg, width, height, approx };
}
