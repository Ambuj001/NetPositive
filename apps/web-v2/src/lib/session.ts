const key = (address: string) => `np.session.${address.toLowerCase()}`;

export type StoredSession = { token: string; verified: boolean };

export function readSession(address: string): StoredSession | null {
  if (!address) return null;
  try {
    const raw = sessionStorage.getItem(key(address));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (!parsed.token) return null;
    return { token: parsed.token, verified: !!parsed.verified };
  } catch {
    return null;
  }
}

export function writeSession(address: string, session: StoredSession) {
  sessionStorage.setItem(key(address), JSON.stringify(session));
}

export function clearSession(address: string) {
  if (!address) return;
  sessionStorage.removeItem(key(address));
}
