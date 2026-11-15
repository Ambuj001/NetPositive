/**
 * Phone browsers have no wallet extension. These links open this site inside a wallet app's own browser, where the
 * wallet is injected and connecting works like on desktop. Pure functions (no window, no env) so node tests can
 * import them.
 */

/** True for phones and tablets, including iPadOS, which reports itself as a Mac with a touch screen. */
export function isMobile(userAgent: string, maxTouchPoints = 0): boolean {
  if (/Android|iPhone|iPad|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini|Mobile Safari|Mobi/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

export type AppLink = { id: "metamask" | "okx" | "trust" | "coinbase"; name: string; href: string };

/** MetaMask wants the address without the scheme: https://metamask.app.link/dapp/<host + path>. */
export function metamaskLink(url: string) {
  return `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//i, "")}`;
}

/** OKX: its own `okx://` deep link, wrapped in the universal link so it also works when the app is not installed. */
export function okxLink(url: string) {
  const deep = `okx://wallet/dapp/url?dappUrl=${encodeURIComponent(url)}`;
  return `https://www.okx.com/download?deeplink=${encodeURIComponent(deep)}`;
}

export function trustLink(url: string) {
  return `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(url)}`;
}

export function coinbaseLink(url: string) {
  return `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`;
}

/** "Open in wallet app" links for the page at `url` (a full http(s) address). Empty for anything else. */
export function appLinks(url: string): AppLink[] {
  if (!/^https?:\/\/[^\s/]+/i.test(url)) return [];
  return [
    { id: "metamask", name: "MetaMask", href: metamaskLink(url) },
    { id: "okx", name: "OKX Wallet", href: okxLink(url) },
    { id: "trust", name: "Trust Wallet", href: trustLink(url) },
    { id: "coinbase", name: "Coinbase Wallet", href: coinbaseLink(url) },
  ];
}

export type WalletConnectOptions = {
  projectId: string;
  optionalChains: [number, ...number[]];
  rpcMap: Record<number, string>;
  showQrModal: true;
  metadata: { name: string; description: string; url: string; icons: string[] };
};

/**
 * WalletConnect session settings for the configured Arc network. The chain is asked for as optional rather than
 * required: a required chain a wallet doesn't ship with makes the wallet refuse the whole session, while an optional
 * one still connects and the escrow steps then add or switch to it.
 */
export function walletConnectOptions(chain: { id: number; rpc: string }, origin: string, projectId: string, app = { name: "NetPositive", description: "Spend crypto anywhere. Keep every reward." }): WalletConnectOptions {
  const site = origin.replace(/\/$/, "");
  return {
    projectId,
    optionalChains: [chain.id],
    rpcMap: { [chain.id]: chain.rpc },
    showQrModal: true,
    metadata: { name: app.name, description: app.description, url: site, icons: [`${site}/favicon.svg`] },
  };
}
