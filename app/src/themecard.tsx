import { themeStyle } from './look.ts';
import type { AppTheme } from './themes.ts';

// A theme in miniature, light half and dark half: a bar, a pill, and a removed and an added line of code.
export function ThemeThumb({ t }: { t: AppTheme | null }) {
  const c = (k: string, text: string) => <span style={{ color: `var(--hl-${k})` }}>{text}</span>;
  return (
    <span class={t ? 'thm' : 'thm lgtm-colors'} style={themeStyle(t)} aria-hidden="true">
      {(['light', 'dark'] as const).map((m) => (
        <span class="thm-half" style={{ colorScheme: m }}>
          <span class="thm-bar">
            <i class="thm-title" /> <i class="thm-pill" />
          </span>
          <span class="thm-line thm-del">{c('kw', 'val')} {c('fn', 'total')} = {c('const', '0')}</span>
          <span class="thm-line thm-add">{c('kw', 'val')} {c('fn', 'total')} = {c('str', '"sum"')}</span>
          <span class="thm-line">{c('com', '// cart')}</span>
        </span>
      ))}
    </span>
  );
}
