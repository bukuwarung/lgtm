declare const __APP_VERSION__: string;
declare const __DEV_BUILD__: boolean; // not built by scripts/release.sh
declare module 'virtual:hljs-languages' {
  export const alias: Record<string, string>; // a name or file extension: its highlight.js language
  export const load: Record<string, () => Promise<{ default: import('highlight.js').LanguageFn }>>;
}
declare const __COMMIT__: string; // the build's git commit, short ('' outside a checkout)
