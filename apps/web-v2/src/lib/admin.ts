/**
 * Administrator routes. The server is the real gate (every /admin route checks the wallet); the app only uses
 * `useIsAdmin` to decide whether to show the Admin link and page.
 *
 * GET /admin/me        → { admin }
 * GET /admin/overview  → settings, contract terms, order counts, open disputes, server health   (admin only)
 * PUT /admin/settings  { worldIdRequired } → { settings }                                        (admin only)
 */
import { useEffect, useState } from "react";
import { api, type ReqStatus } from "./api";
import { useApp } from "./store";

export type AdminSettings = { worldIdRequired: boolean; updatedBy: string | null; updatedAt: string | null };

export type AdminDispute = {
  id: string;
  brand: string;
  amountUsdc: string;
  crypto_spender: string;
  crypto_buyer: string | null;
  category: string | null;
  disputedAt: string | null;
};

export type AdminOverview = {
  settings: AdminSettings;
  /** Same shape as GET /escrow/terms; read with `parseTerms`. */
  terms: unknown;
  orders: Partial<Record<ReqStatus, number>>;
  disputes: AdminDispute[];
  keeper: { address: string; gasUsdc: string | null; low: boolean } | null;
  arbiterKeyOnServer: boolean;
  worldId: { ready: boolean; problem: string | null; environment: string; mock: boolean; bypass: boolean };
  server: { env: string; escrowMode: string; chainId: number; voucherMode: string; admins: string[]; rateCheckPct: number };
};

export const adminApi = {
  me: (token: string) => api<{ admin: boolean }>("/admin/me", { token }),
  overview: (token: string) => api<AdminOverview>("/admin/overview", { token }),
  setWorldIdRequired: (worldIdRequired: boolean, token: string) =>
    api<{ settings: AdminSettings }>("/admin/settings", { method: "PUT", body: { worldIdRequired }, token }),
};

/** One question per sign-in: the answer is remembered for the token it was asked with. */
const asked = new Map<string, Promise<boolean>>();

function isAdmin(token: string) {
  let p = asked.get(token);
  if (!p) {
    p = adminApi
      .me(token)
      .then((r) => r.admin === true)
      .catch(() => {
        asked.delete(token); // a network blip shouldn't hide the link for the rest of the session
        return false;
      });
    asked.set(token, p);
  }
  return p;
}

/**
 * Whether the signed-in wallet is an administrator. `checked` is false while there is no sign-in or the answer is
 * still on its way. Hides UI only; the server refuses non-administrators on every admin route.
 */
export function useIsAdmin(): { admin: boolean; checked: boolean } {
  const { token } = useApp();
  const [state, setState] = useState<{ token: string | null; admin: boolean }>({ token: null, admin: false });
  useEffect(() => {
    if (!token) return;
    let live = true;
    void isAdmin(token).then((admin) => live && setState({ token, admin }));
    return () => {
      live = false;
    };
  }, [token]);
  const checked = !!token && state.token === token;
  return { admin: checked && state.admin, checked };
}
