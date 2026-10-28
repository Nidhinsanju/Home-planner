// What the browser can tell about the device beyond the User-Agent, sent with sign-up, login
// and the session check (see devicePrint.ts on the server). Every field is optional: browsers
// without these APIs (Firefox, Safari) simply send less.
export type DeviceHintsInput = { platform?: string; platformVersion?: string; connectionType?: string; effectiveType?: string };

export async function deviceHints(): Promise<DeviceHintsInput> {
  if (typeof navigator === 'undefined') return {};
  const nav = navigator as any;
  const hints: DeviceHintsInput = {};
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
