// AndroidManifest.xml, as what a reviewer checks: permissions the app asks for, and components other apps can reach
// (exported: an activity, service, receiver or provider anyone can start or bind to).

// Permissions the user is asked for, or that reach far (Android's "dangerous" and special ones).
const RISKY = new Set(
  'CAMERA RECORD_AUDIO ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION ACCESS_BACKGROUND_LOCATION READ_CONTACTS WRITE_CONTACTS GET_ACCOUNTS READ_CALENDAR WRITE_CALENDAR READ_SMS SEND_SMS RECEIVE_SMS RECEIVE_MMS READ_PHONE_STATE READ_PHONE_NUMBERS CALL_PHONE READ_CALL_LOG WRITE_CALL_LOG ANSWER_PHONE_CALLS BLUETOOTH_CONNECT BLUETOOTH_SCAN BLUETOOTH_ADVERTISE NEARBY_WIFI_DEVICES READ_EXTERNAL_STORAGE WRITE_EXTERNAL_STORAGE MANAGE_EXTERNAL_STORAGE READ_MEDIA_IMAGES READ_MEDIA_VIDEO READ_MEDIA_AUDIO BODY_SENSORS ACTIVITY_RECOGNITION POST_NOTIFICATIONS SYSTEM_ALERT_WINDOW REQUEST_INSTALL_PACKAGES QUERY_ALL_PACKAGES WRITE_SETTINGS USE_FULL_SCREEN_INTENT SCHEDULE_EXACT_ALARM'.split(' '),
);
export const isRisky = (perm: string) => RISKY.has(perm.replace(/^android\.permission\./, ''));
export const isManifest = (path: string) => /(^|\/)AndroidManifest\.xml$/.test(path);

type Component = { type: string; name: string; exported: boolean; implicit: boolean }; // implicit: by an intent-filter
type Manifest = { perms: Set<string>; dropped: Set<string>; comps: Map<string, Component> }; // dropped: tools:node="remove"

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`))?.[1];

export function readManifest(xml: string): Manifest {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '');
  const perms = new Set<string>(), dropped = new Set<string>();
  for (const [tag] of text.matchAll(/<uses-permission(?:-sdk-23)?\b[^>]*>/g)) {
    const name = attr(tag, 'android:name');
    if (name) (attr(tag, 'tools:node') === 'remove' ? dropped : perms).add(name);
  }
  const comps = new Map<string, Component>();
  for (const m of text.matchAll(/<(activity-alias|activity|service|receiver|provider)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g)) {
    const name = attr(m[2], 'android:name');
    if (!name) continue;
    const said = attr(m[2], 'android:exported');
    const filters = /<intent-filter\b/.test(m[4] ?? '');
    comps.set(name, { type: m[1], name, exported: said ? said === 'true' : filters, implicit: !said && filters });
  }
  return { perms, dropped, comps };
}

export type ManifestChanges = { added: string[]; removed: string[]; newComps: Component[]; goneComps: Component[]; nowExported: Component[] };
export function manifestChanges(before: string, after: string): ManifestChanges {
  const a = readManifest(before), b = readManifest(after);
  return {
    added: [...b.perms].filter((p) => !a.perms.has(p)),
    removed: [...a.perms].filter((p) => !b.perms.has(p)).concat([...b.dropped].filter((p) => !a.dropped.has(p))),
    newComps: [...b.comps.values()].filter((c) => !a.comps.has(c.name)),
    goneComps: [...a.comps.values()].filter((c) => !b.comps.has(c.name)),
    nowExported: [...b.comps.values()].filter((c) => c.exported && a.comps.has(c.name) && !a.comps.get(c.name)!.exported),
  };
}
