// GitHub's emoji shortcodes (name → image URL), loaded once by github.ts getEmojis(). markdown.ts reads it to draw
// :shortcodes: in locally rendered markdown (pending drafts); null until loaded.
export let emojiMap: Record<string, string> | null = null;
export const setEmojiMap = (m: Record<string, string>) => {
  emojiMap = m;
};
