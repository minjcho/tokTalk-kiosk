// Only fixed categories are accepted. Never pass a session, receipt or customer
// input to the analytics tracker, even as an extra property.
export type EntryPath = 'voice' | 'menu_button' | 'text' | 'unknown';
export type MenuOpenSource = 'button' | 'voice' | 'text';

type EntryData = { entry_path: EntryPath; is_entry: boolean };
export type KioskEvent =
  | ({ name: 'kiosk_recording_started' } & EntryData)
  | ({ name: 'kiosk_menu_opened'; source: MenuOpenSource } & EntryData)
  | { name: 'kiosk_order_confirmed'; entry_path: EntryPath };

type AnalyticsData = Record<string, string | boolean>;
declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsData): void | Promise<unknown>;
    };
  }
}

const ENTRY_PATHS: readonly string[] = ['voice', 'menu_button', 'text', 'unknown'];
const MENU_SOURCES: readonly string[] = ['button', 'voice', 'text'];

export function trackKioskEvent(event: KioskEvent): void {
  if (typeof window === 'undefined') return;
  try {
    if (!ENTRY_PATHS.includes(event.entry_path)) return;
    let data: AnalyticsData;
    // Rebuild every payload: extra runtime fields cannot leak through a spread.
    switch (event.name) {
      case 'kiosk_recording_started':
        if (typeof event.is_entry !== 'boolean') return;
        data = { entry_path: event.entry_path, is_entry: event.is_entry };
        break;
      case 'kiosk_menu_opened':
        if (!MENU_SOURCES.includes(event.source) || typeof event.is_entry !== 'boolean') return;
        data = { source: event.source, entry_path: event.entry_path, is_entry: event.is_entry };
        break;
      case 'kiosk_order_confirmed':
        data = { entry_path: event.entry_path };
        break;
      default:
        return;
    }
    const result = window.umami?.track(event.name, data);
    // Umami versions can return a promise. Catch both throws and rejections.
    if (result) void Promise.resolve(result).catch(() => {});
  } catch {
    // Optional analytics must never interrupt ordering. No retry or content log.
  }
}

// One instance per kiosk controller, reset for each new customer. No identifiers,
// storage, queue or network retry; an absent/failed tracker drops the event.
export function createKioskAnalytics() {
  let entryPath: EntryPath = 'unknown';
  let recording = false;
  let menuOpen = false;
  let confirmed = false;

  function entry(path: Exclude<EntryPath, 'unknown'>): EntryData {
    const isEntry = entryPath === 'unknown';
    if (isEntry) entryPath = path;
    return { entry_path: entryPath, is_entry: isEntry };
  }

  return {
    recordingChanged(active: boolean) {
      if (recording === active) return;
      recording = active;
      if (active && !confirmed) {
        trackKioskEvent({ name: 'kiosk_recording_started', ...entry('voice') });
      }
    },
    menuChanged(open: boolean, source: MenuOpenSource = 'button') {
      if (menuOpen === open) return;
      menuOpen = open;
      if (open && !confirmed) {
        trackKioskEvent({
          name: 'kiosk_menu_opened', source,
          ...entry(source === 'button' ? 'menu_button' : source),
        });
      }
    },
    orderConfirmed() {
      if (confirmed) return;
      confirmed = true;
      trackKioskEvent({ name: 'kiosk_order_confirmed', entry_path: entryPath });
    },
    reset() {
      entryPath = 'unknown';
      recording = false;
      menuOpen = false;
      confirmed = false;
    },
  };
}
