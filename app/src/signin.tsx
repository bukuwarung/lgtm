// The sign-in page (main.tsx shows it until the first sign-in works; #/demo/scene-signin draws it for the README).
import { useState } from 'preact/hooks';
import { isDesktop } from './platform.ts';
import { AppIcon } from './tags.tsx';

// Before the first sign-in works: what to run, and a button to try again (nothing to restart).
export function Setup({ error, retry }: { error: string; retry: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const missing = /isn't installed/.test(error);
  return (
    <div class="signin">
      {/* The first thing a new teammate sees: the app, then what it needs. */}
      <header class="hero">
        <AppIcon size={96} />
        <h1>LGTM</h1>
        <p class="tagline">Say LGTM and mean it.</p>
      </header>
      <section class="signin-card">
      {isDesktop || /signed in|gh token|gh auth/i.test(error) ? (
        <>
          <p>Signs in through gh or glab, never a password or token. {error}</p>
          <p>In Terminal, run one, or both:</p>
          <pre>{missing ? 'brew install gh\ngh auth login' : 'gh auth login'}</pre>
          <pre>{'brew install glab\nglab auth login'}</pre>
          <p class="note">For GitHub: if your organization enforces SSO, authorize the token for it when GitHub asks. For your own GitLab: <code>glab auth login --hostname gitlab.example.com</code>.</p>
        </>
      ) : (
        <>
          <p class="error">{error}</p>
          <p class="note">The browser version needs the <code>lgtm-web</code> command running: start it in Terminal.</p>
        </>
      )}
      <button class="primary" disabled={busy} onClick={() => (setBusy(true), retry().finally(() => setBusy(false)))}>
        {busy ? 'Checking…' : 'Check again'}
      </button>
      </section>
    </div>
  );
}
