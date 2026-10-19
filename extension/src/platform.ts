// The only file that touches extension APIs. Both browsers return promises in MV3.
const ext = (globalThis as any).browser ?? (globalThis as any).chrome;

const origins = ['https://github.com/*', 'https://api.github.com/*'];

export const storage = {
  get: async <T>(key: string): Promise<T | undefined> => (await ext.storage.local.get(key))[key],
  set: (key: string, value: unknown): Promise<void> => ext.storage.local.set({ [key]: value }),
  remove: (key: string): Promise<void> => ext.storage.local.remove(key),
};

export const hasHostAccess = (): Promise<boolean> => ext.permissions.contains({ origins });
// Must be called directly from a click handler (Firefox requires the user gesture).
export const requestHostAccess = (): Promise<boolean> => ext.permissions.request({ origins });
