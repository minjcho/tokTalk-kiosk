import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createKioskAnalytics, trackKioskEvent, type KioskEvent } from './kiosk-analytics.ts';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

function installTracker(track?: NonNullable<Window['umami']>['track']) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: track ? { umami: { track } } : {},
  });
}

function setup() {
  const events: { name: string; data: Record<string, string | boolean> | undefined }[] = [];
  installTracker((name, data) => { events.push({ name, data }); });
  return { events, analytics: createKioskAnalytics() };
}

test('voice-first: only a successful recording transition is the entry; repeat state is ignored', () => {
  const { events, analytics } = setup();
  analytics.recordingChanged(false); // idle/starting/failure/cancellation
  assert.deepEqual(events, []);
  analytics.recordingChanged(true); // called after recorder.start resolves
  analytics.recordingChanged(true); // duplicate state application/rerender
  analytics.menuChanged(true, 'voice');
  analytics.menuChanged(true, 'voice'); // already open
  analytics.orderConfirmed();
  analytics.orderConfirmed(); // successful receipt retry
  assert.deepEqual(events, [
    { name: 'kiosk_recording_started', data: { entry_path: 'voice', is_entry: true } },
    { name: 'kiosk_menu_opened', data: { source: 'voice', entry_path: 'voice', is_entry: false } },
    { name: 'kiosk_order_confirmed', data: { entry_path: 'voice' } },
  ]);
});

test('button-first: later microphone use does not overwrite the first entry', () => {
  const { events, analytics } = setup();
  analytics.menuChanged(true, 'button');
  analytics.recordingChanged(true);
  analytics.recordingChanged(false); // stop
  analytics.recordingChanged(true); // genuine second recording
  analytics.orderConfirmed();
  assert.deepEqual(events, [
    { name: 'kiosk_menu_opened', data: { source: 'button', entry_path: 'menu_button', is_entry: true } },
    { name: 'kiosk_recording_started', data: { entry_path: 'menu_button', is_entry: false } },
    { name: 'kiosk_recording_started', data: { entry_path: 'menu_button', is_entry: false } },
    { name: 'kiosk_order_confirmed', data: { entry_path: 'menu_button' } },
  ]);
});

test('only closed-to-open transitions count, with the true source of each opening', () => {
  const { events, analytics } = setup();
  analytics.menuChanged(false);
  analytics.menuChanged(true, 'button');
  analytics.menuChanged(true, 'voice'); // request while already open is not an opening
  analytics.menuChanged(false);
  analytics.menuChanged(false);
  analytics.menuChanged(true, 'voice');
  analytics.menuChanged(false);
  analytics.menuChanged(true, 'text');
  assert.deepEqual(events, [
    { name: 'kiosk_menu_opened', data: { source: 'button', entry_path: 'menu_button', is_entry: true } },
    { name: 'kiosk_menu_opened', data: { source: 'voice', entry_path: 'menu_button', is_entry: false } },
    { name: 'kiosk_menu_opened', data: { source: 'text', entry_path: 'menu_button', is_entry: false } },
  ]);
});

test('debug text menu commands are not misclassified as voice', () => {
  const { events, analytics } = setup();
  analytics.menuChanged(true, 'text');
  analytics.orderConfirmed();
  assert.deepEqual(events, [
    { name: 'kiosk_menu_opened', data: { source: 'text', entry_path: 'text', is_entry: true } },
    { name: 'kiosk_order_confirmed', data: { entry_path: 'text' } },
  ]);
});

test('new customer reset clears first path and deduplication without emitting an event', () => {
  const { events, analytics } = setup();
  analytics.menuChanged(true, 'button');
  analytics.orderConfirmed();
  analytics.reset();
  assert.equal(events.length, 2);
  analytics.recordingChanged(true);
  analytics.orderConfirmed();
  assert.deepEqual(events.slice(2), [
    { name: 'kiosk_recording_started', data: { entry_path: 'voice', is_entry: true } },
    { name: 'kiosk_order_confirmed', data: { entry_path: 'voice' } },
  ]);
});

test('confirmation without an observed entry stays unknown; completed customer does not emit more events', () => {
  const { events, analytics } = setup();
  analytics.orderConfirmed();
  analytics.recordingChanged(true);
  analytics.menuChanged(true, 'button');
  assert.deepEqual(events, [{ name: 'kiosk_order_confirmed', data: { entry_path: 'unknown' } }]);
});

test('separate controllers do not share entry paths or deduplication', () => {
  const { events, analytics } = setup();
  const other = createKioskAnalytics();
  analytics.menuChanged(true, 'button');
  other.recordingChanged(true);
  analytics.orderConfirmed();
  other.orderConfirmed();
  assert.deepEqual(events.slice(2), [
    { name: 'kiosk_order_confirmed', data: { entry_path: 'menu_button' } },
    { name: 'kiosk_order_confirmed', data: { entry_path: 'voice' } },
  ]);
});

test('safe no-op without a browser or tracker, with no queued replay when tracker arrives', () => {
  Reflect.deleteProperty(globalThis, 'window');
  assert.doesNotThrow(() => trackKioskEvent({ name: 'kiosk_order_confirmed', entry_path: 'unknown' }));
  installTracker();
  const analytics = createKioskAnalytics();
  analytics.recordingChanged(true);
  const calls: string[] = [];
  installTracker((name) => { calls.push(name); });
  analytics.recordingChanged(true); // absent-tracker event is not replayed
  analytics.orderConfirmed();
  assert.deepEqual(calls, ['kiosk_order_confirmed']);
});

test('tracker throws or a throwing SDK getter cannot break ordering callbacks', () => {
  installTracker(() => { throw new Error('offline'); });
  const analytics = createKioskAnalytics();
  assert.doesNotThrow(() => {
    analytics.recordingChanged(true);
    analytics.menuChanged(true, 'voice');
    analytics.orderConfirmed();
    analytics.reset();
  });
  Object.defineProperty(window, 'umami', { get() { throw new Error('blocked'); } });
  assert.doesNotThrow(() => analytics.orderConfirmed());
});

test('tracker promise rejection is handled, never awaited or retried', async () => {
  let calls = 0;
  installTracker(() => { calls++; return Promise.reject(new Error('offline')); });
  const analytics = createKioskAnalytics();
  assert.equal(analytics.orderConfirmed(), undefined);
  analytics.orderConfirmed();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
});

test('runtime extra fields are stripped from every event, including identifiers and customer content', () => {
  const { events } = setup();
  const forbidden = {
    audioBase64: 'synthetic-audio', transcript: 'synthetic-text', text: 'synthetic-input',
    sessionId: 'synthetic-session', orderNumber: 'synthetic-number', email: 'synthetic-email',
  };
  const allowed: KioskEvent[] = [
    { name: 'kiosk_recording_started', entry_path: 'voice', is_entry: true },
    { name: 'kiosk_menu_opened', source: 'voice', entry_path: 'voice', is_entry: false },
    { name: 'kiosk_order_confirmed', entry_path: 'voice' },
  ];
  for (const event of allowed) trackKioskEvent({ ...event, ...forbidden });
  assert.deepEqual(events, allowed.map(({ name, ...data }) => ({ name, data })));
});

test('arbitrary names, free-form categories and wrong property types cannot be sent', () => {
  const { events } = setup();
  for (const invalid of [
    { name: 'customer_text', entry_path: 'voice' },
    { name: 'kiosk_recording_started', entry_path: 'free-form-input', is_entry: true },
    { name: 'kiosk_recording_started', entry_path: 'voice', is_entry: 'true' },
    { name: 'kiosk_menu_opened', entry_path: 'voice', source: 'free-form-input', is_entry: false },
    { name: 'kiosk_order_confirmed', entry_path: { sessionId: 'synthetic-session' } },
    null,
  ]) {
    assert.doesNotThrow(() => trackKioskEvent(invalid as unknown as KioskEvent));
  }
  assert.deepEqual(events, []);
});
