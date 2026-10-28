// What the browser can tell about the device beyond the User-Agent, sent with sign-up, login
// and the session check (see devicePrint.ts on the server). Every field is optional: browsers
// without these APIs (Firefox, Safari) simply send less.
export type DeviceHintsInput = { platform?: string; platformVersion?: string; connectionType?: string; effectiveType?: string; deviceId?: string };

// This browser's device id: a random UUID made once and kept in localStorage. It identifies the
// device (not the person) for the AI prompt limit and the accounts-per-device limit.
const DEVICE_KEY = 'deviceId';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function newUuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !UUID.test(id)) {
      id = newUuid();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return ''; // storage blocked: the server still has the device print
  }
}

// Headers for the AI routes: the login token and the device id.
export function aiHeaders(token: string): Record<string, string> {
  const id = deviceId();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(id ? { 'X-Device-Id': id } : {}) };
}

export async function deviceHints(): Promise<DeviceHintsInput> {
  if (typeof navigator === 'undefined') return {};
  const nav = navigator as any;
  const hints: DeviceHintsInput = {};
  const id = deviceId();
  if (id) hints.deviceId = id;
  const conn = nav.connection;
  if (typeof conn?.type === 'string') hints.connectionType = conn.type;
  if (typeof conn?.effectiveType === 'string') hints.effectiveType = conn.effectiveType;
  const uad = nav.userAgentData;
  if (typeof uad?.platform === 'string') hints.platform = uad.platform;
  try {
    // The platform version tells Windows 11 from 10. Never wait long for it.
    const high = await Promise.race([
      uad?.getHighEntropyValues?.(['platformVersion']),
      new Promise(resolve => setTimeout(resolve, 300)),
    ]) as { platformVersion?: string } | undefined;
    if (typeof high?.platformVersion === 'string') hints.platformVersion = high.platformVersion;
  } catch {
    // not available
  }
  return hints;
}

// The hints as form fields, for the sign-up and login forms.
export async function addDeviceHints(formData: FormData) {
  formData.set('deviceHints', JSON.stringify(await deviceHints()));
  return formData;
}
