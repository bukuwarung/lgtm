const ext = globalThis.browser ?? chrome;

// Open lgtm after install so Firefox users can grant GitHub access and sign in right away.
ext.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') ext.tabs.create({ url: ext.runtime.getURL('review.html') });
});

ext.action.onClicked.addListener((tab) => {
  // tab.url is only visible once github.com host access is granted; otherwise open the inbox.
  const pr = (tab.url ?? '').match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/);
  ext.tabs.create({ url: ext.runtime.getURL('review.html') + (pr ? '#' + pr[0] : '') });
});
