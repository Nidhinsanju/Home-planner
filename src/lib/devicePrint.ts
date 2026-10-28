import { createHash } from 'node:crypto';
import { z } from 'zod';

// The "device print" kept for each user in the user_devices collection: who they are (name,
// email, never the password), what they use (OS, browser, phone/tablet/desktop), their network
// (IP address and connection type) and roughly where they are (country, region, city), with
// the time it was last seen. One record per user, updated at each sign-up, login and app open.
//
// Everything here is worked out from the request: the User-Agent header, the location headers
// the hosting adds (Vercel, Cloudflare; none when running locally) and a few hints the browser
// sends along (see deviceHints.ts). Nothing is sent to a third party.

export type DevicePrint = {
  deviceId: string; // the browser's random id (see deviceHints.ts)
  fingerprint: string; // hash of network address + browser: the device, even without its id
  os: string;
  browser: string;
  deviceType: 'mobile' | 'tablet' | 'desktop';
  ip: string;
  connectionType: string;
  effectiveType: string;
  country: string;
  region: string;
  city: string;
};

// What the browser may add (all optional, all short): see deviceHints.ts.
// A device id is a random UUID made by the browser.
export const isDeviceId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// The device print as one value: a hash (never the address itself) of the network address
// and the browser, so the same device is recognised after its stored id is cleared.
export const fingerprintOf = (ip: string, userAgent: string) =>
  createHash('sha256').update(`${ip}|${userAgent.slice(0, 512)}`).digest('hex').slice(0, 32);

const hint = z.string().trim().max(40).regex(/^[\w .,-]*$/).optional().catch(undefined);
export const DeviceHints = z.object({
  platform: hint, // navigator.userAgentData.platform, e.g. "Windows"
  platformVersion: hint, // e.g. "15.0.0" (Windows 11 is 13 and up)
  connectionType: hint, // navigator.connection.type, e.g. "wifi"
  effectiveType: hint, // navigator.connection.effectiveType, e.g. "4g"
  deviceId: z.string().refine(isDeviceId).optional().catch(undefined),
}).catch({});
export type DeviceHints = z.infer<typeof DeviceHints>;

const UNKNOWN = 'unknown';

// The operating system, from the browser's hints when it sent them (they tell Windows 11 from
// 10, which the User-Agent no longer does), otherwise from the User-Agent.
export function osFrom(ua: string, hints: DeviceHints = {}): string {
  const version = (v: string | undefined) => (v ?? '').replace(/_/g, '.').split('.').slice(0, 2).join('.');
  if (hints.platform === 'Windows' && hints.platformVersion) return Number(hints.platformVersion.split('.')[0]) >= 13 ? 'Windows 11' : 'Windows 10';
  let m: RegExpMatchArray | null;
  if ((m = ua.match(/Windows NT ([\d.]+)/))) return m[1] === '10.0' ? 'Windows 10/11' : `Windows NT ${m[1]}`;
  if ((m = ua.match(/(?:iPhone|CPU) OS ([\d_]+)/)) && /iPhone|iPod/.test(ua)) return `iOS ${version(m[1])}`;
  if ((m = ua.match(/CPU OS ([\d_]+)/)) && /iPad/.test(ua)) return `iPadOS ${version(m[1])}`;
  if ((m = ua.match(/Android ([\d.]+)/))) return `Android ${version(m[1])}`;
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Mac OS X/.test(ua)) return 'macOS'; // its version in the User-Agent is frozen at 10.15
  if (/Linux/.test(ua)) return 'Linux';
  return hints.platform || UNKNOWN;
}

export function browserFrom(ua: string): string {
  const rules: [RegExp, string][] = [
    [/Edg(?:e|A|iOS)?\/([\d]+)/, 'Edge'],
    [/(?:OPR|Opera)\/([\d]+)/, 'Opera'],
    [/SamsungBrowser\/([\d]+)/, 'Samsung Internet'],
    [/(?:Chrome|CriOS)\/([\d]+)/, 'Chrome'],
    [/(?:Firefox|FxiOS)\/([\d]+)/, 'Firefox'],
    [/Version\/([\d]+).*Safari/, 'Safari'],
  ];
  for (const [re, name] of rules) {
    const m = ua.match(re);
    if (m) return `${name} ${m[1]}`;
  }
  return UNKNOWN;
}

export function deviceTypeFrom(ua: string): DevicePrint['deviceType'] {
  if (/iPad|Tablet/i.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) return 'tablet';
  if (/Mobi|iPhone|iPod/i.test(ua)) return 'mobile';
  return 'desktop';
}

// Country, region and city from the location headers the hosting adds.
// Vercel: x-vercel-ip-country / -country-region / -city. Cloudflare: cf-ipcountry, and with
// "Add visitor location headers" turned on, cf-region and cf-ipcity.
export function locationFrom(h: Headers): Pick<DevicePrint, 'country' | 'region' | 'city'> {
  const read = (...names: string[]) => {
    for (const n of names) {
      const v = h.get(n);
      if (!v) continue;
      let text = v;
      try { text = decodeURIComponent(v); } catch { /* not encoded */ }
      text = text.trim().slice(0, 80);
      // XX: unknown, T1: Tor (Cloudflare).
      if (text && text !== 'XX' && text !== 'T1') return text;
    }
    return UNKNOWN;
  };
  return {
    country: read('x-vercel-ip-country', 'cf-ipcountry'),
    region: read('x-vercel-ip-country-region', 'cf-region'),
    city: read('x-vercel-ip-city', 'cf-ipcity'),
  };
}

// The whole print from the request headers, the caller's address and the browser's hints.
export function devicePrint(h: Headers, ip: string, rawHints: unknown): DevicePrint {
  const hints = DeviceHints.parse(rawHints ?? {});
  const ua = (h.get('user-agent') ?? '').slice(0, 512);
  return {
    deviceId: hints.deviceId || UNKNOWN,
    fingerprint: fingerprintOf(ip || UNKNOWN, ua),
    os: osFrom(ua, hints),
    browser: browserFrom(ua),
    deviceType: deviceTypeFrom(ua),
    ip: ip || UNKNOWN,
    connectionType: hints.connectionType || UNKNOWN,
    effectiveType: hints.effectiveType || UNKNOWN,
    ...locationFrom(h),
  };
}
