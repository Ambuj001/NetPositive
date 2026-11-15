import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ARC, chainIdNumber, switchToArc } from "./arc";
import { ARC_CHAIN_IDS, CHAINS as ARC_NETWORKS, IS_DEV } from "./chain";
import { appLinks, isMobile, walletConnectOptions } from "./walletLinks";
export { ARC, switchToArc };

/** Minimal EIP-1193 provider surface. */
export type Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
  disconnect?: () => Promise<void> | void;
  enable?: () => Promise<unknown>;
  isMetaMask?: boolean;
};

/** EIP-6963 announced wallet. */
export type Announced = {
  info: { uuid: string; name: string; icon?: string; rdns?: string };
  provider: Provider;
};

declare global {
  interface Window {
    ethereum?: Provider;
  }
}

/* ------------------------------------------------------------------ chains */

// Keyed by number so "0x13b2", "0x13B2" and "5042" all find Arc.
const CHAINS: Record<number, string> = {
  1: "Ethereum",
  11155111: "Sepolia",
  8453: "Base",
  84532: "Base Sepolia",
  10: "Optimism",
  42161: "Arbitrum",
  137: "Polygon",
  56: "BNB Chain",
  [ARC_NETWORKS.mainnet.id]: ARC_NETWORKS.mainnet.name,
  [ARC_NETWORKS.testnet.id]: ARC_NETWORKS.testnet.name,
};
export function chainName(id: string) {
  const n = chainIdNumber(id);
  return n ? CHAINS[n] ?? `Chain ${n}` : "";
}
export const shortAddr = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const isAddress = (v: unknown): v is string => typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v);

/** Balance shown on the connected-wallet chip. */
export type ChainBalance = { amount: number; symbol: string };

/** ERC-20 USDC. Arc's gas token is native USDC, so it is read with eth_getBalance instead. */
const USDC_BY_CHAIN: Record<number, { address: string; decimals: number }> = {
  1: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
  11155111: { address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", decimals: 6 },
  8453: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  84532: { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", decimals: 6 },
  10: { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
  42161: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
  137: { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
};

const NATIVE_BY_CHAIN: Record<number, { symbol: string; decimals: number }> = {
  1: { symbol: "ETH", decimals: 18 },
  11155111: { symbol: "ETH", decimals: 18 },
  8453: { symbol: "ETH", decimals: 18 },
  84532: { symbol: "ETH", decimals: 18 },
  10: { symbol: "ETH", decimals: 18 },
  42161: { symbol: "ETH", decimals: 18 },
  137: { symbol: "POL", decimals: 18 },
  56: { symbol: "BNB", decimals: 18 },
  [ARC_NETWORKS.mainnet.id]: { symbol: "USDC", decimals: 18 },
  [ARC_NETWORKS.testnet.id]: { symbol: "USDC", decimals: 18 },
};

function parseHex(raw: unknown) {
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]+$/.test(raw)) return 0n;
  return BigInt(raw);
}

function fromUnits(raw: bigint, decimals: number) {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = (raw % base).toString().padStart(decimals, "0").slice(0, 8);
  return Number(`${whole}.${frac}`);
}

/** USDC in the connected wallet, or the chain's native coin when this network has no USDC contract. */
export async function readWalletBalance(provider: Provider, holder: string, chainId: string): Promise<ChainBalance> {
  const id = chainIdNumber(chainId);
  if (ARC_CHAIN_IDS.includes(id)) {
    const raw = parseHex(await provider.request({ method: "eth_getBalance", params: [holder, "latest"] }));
    return { amount: fromUnits(raw, 18), symbol: "USDC" };
  }
  const token = USDC_BY_CHAIN[id];
  if (token) {
    try {
      const data = "0x70a08231" + holder.slice(2).toLowerCase().padStart(64, "0");
      const raw = parseHex(await provider.request({ method: "eth_call", params: [{ to: token.address, data }, "latest"] }));
      return { amount: fromUnits(raw, token.decimals), symbol: "USDC" };
    } catch {
      /* Contract call failed on this network. Show the native balance instead of a made-up number. */
    }
  }
  const native = NATIVE_BY_CHAIN[id] ?? { symbol: "ETH", decimals: 18 };
  const raw = parseHex(await provider.request({ method: "eth_getBalance", params: [holder, "latest"] }));
  return { amount: fromUnits(raw, native.decimals), symbol: native.symbol };
}

export function formatChainBalance(balance: ChainBalance) {
  const digits = balance.symbol === "USDC" ? 2 : balance.amount > 0 && balance.amount < 1 ? 4 : 2;
  const text = balance.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits });
  return `${text} ${balance.symbol}`;
}

/* ----------------------------------------------------------------- catalog */

const APP = {
  name: "NetPositive",
  logo: typeof window !== "undefined" ? `${window.location.origin}/favicon.svg` : "",
};
const WC_PROJECT_ID = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined)?.trim() || "";

type Fallback = "base-sdk" | "coinbase-sdk" | "walletconnect" | "install";

type CatalogEntry = {
  id: string;
  name: string;
  /** EIP-6963 rdns values that identify the installed extension. */
  rdns: string[];
  /** Legacy window.ethereum flags that identify it when the wallet doesn't announce itself (EIP-6963). */
  flag?: string;
  /** What to do when the extension isn't installed. */
  fallback: Fallback;
  install?: string;
  /** Can't add networks it doesn't ship with, so it can sign in but not use the escrow on Arc. */
  limited?: boolean;
};

const CATALOG: CatalogEntry[] = [
  { id: "metamask", name: "MetaMask", rdns: ["io.metamask", "io.metamask.flask", "io.metamask.mobile"], flag: "isMetaMask", fallback: "install", install: "https://metamask.io/download/" },
  { id: "coinbase", name: "Coinbase Wallet", rdns: ["com.coinbase.wallet"], flag: "isCoinbaseWallet", fallback: "coinbase-sdk" },
  { id: "base", name: "Base Account", rdns: [], fallback: "base-sdk" },
  { id: "rabby", name: "Rabby", rdns: ["io.rabby"], flag: "isRabby", fallback: "install", install: "https://rabby.io/" },
  { id: "rainbow", name: "Rainbow", rdns: ["me.rainbow"], flag: "isRainbow", fallback: "walletconnect", install: "https://rainbow.me/download" },
  { id: "trust", name: "Trust Wallet", rdns: ["com.trustwallet.app"], flag: "isTrust", fallback: "walletconnect", install: "https://trustwallet.com/download" },
  { id: "okx", name: "OKX Wallet", rdns: ["com.okex.wallet"], flag: "isOkxWallet", fallback: "walletconnect", install: "https://www.okx.com/web3" },
  { id: "phantom", name: "Phantom", rdns: ["app.phantom"], flag: "isPhantom", fallback: "install", install: "https://phantom.com/download", limited: true },
  { id: "zerion", name: "Zerion", rdns: ["io.zerion.wallet"], flag: "isZerion", fallback: "walletconnect", install: "https://zerion.io/download" },
  { id: "brave", name: "Brave Wallet", rdns: ["com.brave.wallet"], flag: "isBraveWallet", fallback: "install", install: "https://brave.com/wallet/" },
  { id: "walletconnect", name: "WalletConnect", rdns: [], fallback: "walletconnect" },
];

/** `app`: a link that opens this site inside the wallet app's browser (phones). `unavailable`: development hint only. */
export type WalletStatus = "installed" | "popup" | "qr" | "app" | "install" | "unavailable";

/** A phone or tablet browser. Decided once: the device doesn't change while the page is open. */
export const ON_MOBILE = typeof navigator !== "undefined" && isMobile(navigator.userAgent || "", navigator.maxTouchPoints || 0);

/** One row in the wallet picker. */
export type WalletChoice = {
  id: string;
  name: string;
  /** Real icon from the installed extension (data: URI), if any. */
  icon?: string;
  status: WalletStatus;
  /** Short line under the name. */
  hint: string;
  install?: string;
  /** `app` rows: the link that opens this page inside the wallet app. */
  href?: string;
  /** Installed extension provider, when present. */
  announced?: Announced;
  fallback: Fallback;
  /** Can sign in, but can't add the Arc network. */
  limited?: boolean;
};

/* ----------------------------------------------------------- SDK providers */

// Created lazily and cached so the popup can open inside the click gesture.
const sdkCache: Partial<Record<"base-sdk" | "coinbase-sdk", Provider>> = {};
let wcProvider: Provider | null = null;

async function loadSdk(kind: "base-sdk" | "coinbase-sdk"): Promise<Provider> {
  if (sdkCache[kind]) return sdkCache[kind]!;
  if (kind === "base-sdk") {
    const { createBaseAccountSDK } = await import("@base-org/account");
    sdkCache[kind] = createBaseAccountSDK({
      appName: APP.name,
      appLogoUrl: APP.logo,
      // Base stays first (the SDK starts on the first id); Arc is listed so the SDK accepts switching to it.
      appChainIds: [8453, 84532, ARC.id],
      preference: { telemetry: false },
    }).getProvider() as unknown as Provider;
  } else {
    const { createCoinbaseWalletSDK } = await import("@coinbase/wallet-sdk");
    sdkCache[kind] = createCoinbaseWalletSDK({
      appName: APP.name,
      appLogoUrl: APP.logo,
      appChainIds: [8453, 84532, 1, ARC.id],
      preference: { options: "all" },
    }).getProvider() as unknown as Provider;
  }
  return sdkCache[kind]!;
}

async function loadWalletConnect(): Promise<Provider> {
  if (wcProvider) return wcProvider;
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  // Only the configured Arc network is asked for (see walletConnectOptions), with its RPC so reads don't depend on
  // WalletConnect's own RPC knowing the chain.
  wcProvider = (await EthereumProvider.init(walletConnectOptions(ARC, window.location.origin, WC_PROJECT_ID))) as unknown as Provider;
  return wcProvider;
}

/** Warm SDK modules when the picker opens so popups aren't blocked. */
export function preloadConnectors() {
  void import("@base-org/account").catch(() => {});
  void import("@coinbase/wallet-sdk").catch(() => {});
}

/* ---------------------------------------------------------------- messages */

export function walletMessage(error: unknown) {
  const e = error as { code?: number; message?: string; data?: { originalError?: { code?: number } } };
  const msg = e?.message ?? "";
  if (e?.code === 4001 || /reject|denied|closed|cancel/i.test(msg)) return "You rejected the request in your wallet. Try again when you're ready.";
  if (e?.code === -32002 || /already pending|already processing/i.test(msg)) return "Your wallet already has a request open. Open the wallet and finish or close it.";
  if (/popup/i.test(msg)) return "Your browser blocked the wallet popup. Allow popups for this site and try again.";
  if (/locked|unlock/i.test(msg)) return "Your wallet is locked. Unlock it and try again.";
  if (/project ?id/i.test(msg)) return "WalletConnect isn't set up yet (missing project ID).";
  return msg && msg.length < 140 ? `Couldn't connect: ${msg}` : "Couldn't connect. Open your wallet and try again.";
}

/* ------------------------------------------------- remember last wallet */

// Only which wallet was used (id + extension rdns). The wallet itself decides whether the site is still approved.
const SAVED_KEY = "np.wallet.last";
type Saved = { id: string; rdns?: string; kind: Session["kind"] };
function readSaved(): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "null");
    return v && typeof v.id === "string" ? v : null;
  } catch {
    return null;
  }
}
function writeSaved(v: Saved | null) {
  try {
    if (v) localStorage.setItem(SAVED_KEY, JSON.stringify(v));
    else localStorage.removeItem(SAVED_KEY);
  } catch {
    /* storage blocked: reconnect just won't persist */
  }
}
const toHexChain = (c: unknown) => (typeof c === "string" ? c : typeof c === "number" ? "0x" + c.toString(16) : "");

/* -------------------------------------------------------------------- hook */

type Session = { id: string; name: string; icon?: string; provider: Provider; kind: "injected" | Fallback };

function legacyName(p: Provider & Record<string, unknown>) {
  const hit = CATALOG.find((c) => c.flag && p[c.flag]);
  // Many wallets set isMetaMask for compatibility; prefer the more specific flag.
  if (hit?.id === "metamask") {
    const specific = CATALOG.find((c) => c.flag && c.id !== "metamask" && p[c.flag]);
    if (specific) return specific;
  }
  return hit;
}

export function useWallet() {
  const [announced, setAnnounced] = useState<Announced[]>([]);
  const [discovered, setDiscovered] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [walletBalance, setWalletBalance] = useState<ChainBalance | null>(null);
  const [restoring, setRestoring] = useState(() => readSaved() !== null);
  const attemptRef = useRef(0);
  const restoreTried = useRef(false);

  // Discover installed extensions (EIP-6963), plus the legacy window.ethereum for wallets that don't announce.
  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const w = (event as CustomEvent<Announced>).detail;
      if (!w?.info?.uuid || typeof w.provider?.request !== "function") return;
      setAnnounced((prev) => [...prev.filter((x) => x.info.uuid !== w.info.uuid && x.provider !== w.provider), w]);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const t = setTimeout(() => {
      const provider = window.ethereum as (Provider & Record<string, unknown>) | undefined;
      if (provider && typeof provider.request === "function") {
        setAnnounced((prev) => {
          if (prev.some((a) => a.provider === provider)) return prev;
          const known = legacyName(provider);
          // If the same wallet already announced itself, the legacy object is a duplicate.
          if (known && prev.some((a) => a.info.rdns && known.rdns.includes(a.info.rdns))) return prev;
          return [...prev, { info: { uuid: "injected", name: known?.name ?? "Browser wallet", rdns: known?.rdns[0] ?? "" }, provider }];
        });
      }
      setDiscovered(true);
    }, 350);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(t);
    };
  }, []);

  // Build picker rows: installed first, then the catalog.
  const choices = useMemo<WalletChoice[]>(() => {
    const used = new Set<string>();
    // A phone browser with no injected wallet: extensions can't be installed there, so offer to open this page
    // inside a wallet app instead.
    const phone = ON_MOBILE && announced.length === 0;
    const links = phone ? appLinks(window.location.href) : [];
    const rows: WalletChoice[] = [];
    for (const c of CATALOG) {
      const hit = announced.find((a) => a.info.rdns && c.rdns.includes(a.info.rdns));
      if (hit) {
        used.add(hit.info.uuid);
        rows.push({ id: c.id, name: c.name, icon: hit.info.icon, status: "installed", hint: c.limited ? `Sign-in only · can't use ${ARC.name}` : "Detected in this browser", announced: hit, fallback: c.fallback, install: c.install, limited: c.limited });
        continue;
      }
      const base = { id: c.id, name: c.name, fallback: c.fallback, install: c.install };
      const link = links.find((l) => l.id === c.id);
      if (link) rows.push({ ...base, status: "app", hint: "Opens this site in the app", href: link.href });
      else if (c.fallback === "base-sdk") rows.push({ ...base, status: "popup", hint: "Passkey smart wallet · no extension" });
      else if (c.fallback === "coinbase-sdk") rows.push({ ...base, status: "popup", hint: "Coinbase app or popup" });
      else if (c.fallback === "walletconnect" && WC_PROJECT_ID) rows.push({ ...base, status: "qr", hint: c.id === "walletconnect" ? (phone ? "Any wallet app on this phone" : "Any mobile wallet · scan a QR") : phone ? "Connect through WalletConnect" : "Scan with the mobile app" });
      // No WalletConnect project id: people never see a dead row. Developers get a hint on the WalletConnect row.
      else if (c.id === "walletconnect") {
        if (IS_DEV) rows.push({ ...base, status: "unavailable", hint: "Dev: set VITE_WALLETCONNECT_PROJECT_ID" });
      }
      // "Get the extension" only makes sense where extensions exist.
      else if (!phone && c.install) rows.push({ ...base, status: "install", hint: "Not detected · get it" });
    }
    const others: WalletChoice[] = announced
      .filter((a) => !used.has(a.info.uuid))
      .map((a) => ({ id: a.info.rdns || a.info.uuid, name: a.info.name, icon: a.info.icon, status: "installed", hint: "Detected in this browser", announced: a, fallback: "install" }));
    const rank = (r: WalletChoice) => (r.status === "installed" ? 0 : r.status === "app" ? 1 : 2);
    return [...rows.filter((r) => r.status === "installed"), ...others, ...rows.filter((r) => r.status !== "installed").sort((a, b) => rank(a) - rank(b))];
  }, [announced]);

  const adopt = useCallback((choice: WalletChoice, provider: Provider, kind: Session["kind"], account: string, chain: unknown) => {
    setSession({ id: choice.id, name: choice.name, icon: choice.icon, provider, kind });
    setAddress(account);
    setChainId(toHexChain(chain));
    writeSaved({ id: choice.id, rdns: choice.announced?.info.rdns || undefined, kind });
  }, []);

  // After a reload, reconnect the last wallet silently. eth_accounts never opens a popup and returns [] when the
  // person revoked this site inside the wallet, so nothing is forced.
  useEffect(() => {
    if (!discovered || restoreTried.current) return;
    restoreTried.current = true;
    const saved = readSaved();
    if (!saved) {
      setRestoring(false);
      return;
    }
    const choice = choices.find((c) => c.id === saved.id) ?? (saved.rdns ? choices.find((c) => c.announced?.info.rdns === saved.rdns) : undefined);
    const attempt = ++attemptRef.current;
    (async () => {
      try {
        if (!choice) return;
        let provider: Provider | null = null;
        let kind: Session["kind"] = "injected";
        if (choice.announced) provider = choice.announced.provider;
        else if (saved.kind === "base-sdk" || saved.kind === "coinbase-sdk") {
          provider = await loadSdk(saved.kind);
          kind = saved.kind;
        } else if (saved.kind === "walletconnect" && WC_PROJECT_ID) {
          provider = await loadWalletConnect();
          kind = "walletconnect";
        }
        if (!provider) return;
        const accounts = await provider.request({ method: "eth_accounts" });
        const first = Array.isArray(accounts) ? accounts[0] : undefined;
        if (!isAddress(first) || attempt !== attemptRef.current) return;
        const chain = await provider.request({ method: "eth_chainId" }).catch(() => "");
        adopt(choice, provider, kind, first, chain);
      } catch {
        /* silent: they can connect by hand */
      } finally {
        if (attempt === attemptRef.current) setRestoring(false);
      }
    })();
  }, [discovered, choices, adopt]);

  // Live balance for the navbar.
  useEffect(() => {
    const provider = session?.provider;
    if (!provider || !address) {
      setWalletBalance(null);
      return;
    }
    let cancel = false;
    const load = async () => {
      try {
        const next = await readWalletBalance(provider, address, chainId);
        if (!cancel) setWalletBalance(next);
      } catch {
        if (!cancel) setWalletBalance(null);
      }
    };
    setWalletBalance(null);
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancel = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [session, address, chainId]);

  // Follow account / network changes made inside the wallet.
  useEffect(() => {
    const p = session?.provider;
    if (!p) return;
    const onAccounts = (accounts: unknown) => {
      const first = Array.isArray(accounts) ? accounts[0] : undefined;
      // A different account is a different person as far as the app goes: the store drops the old sign-in (it is
      // kept per address) and signs in again when it next needs to.
      if (isAddress(first)) setAddress(first);
      else {
        setAddress("");
        setChainId("");
        setSession(null);
        writeSaved(null);
      }
    };
    const onChain = (c: unknown) => setChainId(toHexChain(c));
    const onDisconnect = (err?: unknown) => {
      // MetaMask emits disconnect with code 1013 while it reconnects to its RPC. That is not the user leaving.
      if ((err as { code?: number } | undefined)?.code === 1013) return;
      attemptRef.current++;
      setAddress("");
      setChainId("");
      setSession(null);
      // A WalletConnect or SDK session that ended is gone for good; don't try to restore it on the next load.
      if (session?.kind !== "injected") writeSaved(null);
    };
    p.on?.("accountsChanged", onAccounts);
    p.on?.("chainChanged", onChain);
    p.on?.("disconnect", onDisconnect);
    return () => {
      p.removeListener?.("accountsChanged", onAccounts);
      p.removeListener?.("chainChanged", onChain);
      p.removeListener?.("disconnect", onDisconnect);
    };
  }, [session]);

  /**
   * Opens the chosen wallet's own approval UI (extension popup, Base/Coinbase popup, or WalletConnect QR).
   * Resolves true when the user approves.
   */
  const connect = useCallback(
    async (choice: WalletChoice) => {
      if (choice.status === "install") {
        if (choice.install) window.open(choice.install, "_blank", "noopener,noreferrer");
        return false;
      }
      if (choice.status === "app") {
        // Leaves this page: the wallet app opens it again in its own browser, where the wallet is injected.
        if (choice.href) window.location.assign(choice.href);
        return false;
      }
      if (choice.status === "unavailable") {
        setError("WalletConnect needs a free project ID. Add VITE_WALLETCONNECT_PROJECT_ID to apps/web-v2/.env and restart.");
        return false;
      }
      const attempt = ++attemptRef.current;
      setPending(choice.id);
      setError("");
      try {
        let provider: Provider;
        let kind: Session["kind"];
        if (choice.announced) {
          provider = choice.announced.provider;
          kind = "injected";
        } else if (choice.fallback === "walletconnect") {
          provider = await loadWalletConnect();
          kind = "walletconnect";
          await provider.enable?.(); // shows the QR modal
        } else {
          provider = await loadSdk(choice.fallback as "base-sdk" | "coinbase-sdk");
          kind = choice.fallback;
        }
        const accounts = await provider.request({ method: "eth_requestAccounts" });
        const first = Array.isArray(accounts) ? accounts[0] : undefined;
        if (!isAddress(first)) throw new Error("Wallet returned no account");
        const chain = await provider.request({ method: "eth_chainId" }).catch(() => "");
        if (attempt !== attemptRef.current) return false;
        adopt(choice, provider, kind, first, chain);
        return true;
      } catch (e) {
        if (attempt === attemptRef.current) setError(walletMessage(e));
        return false;
      } finally {
        if (attempt === attemptRef.current) setPending(null);
      }
    },
    [adopt],
  );

  const disconnect = useCallback(async () => {
    attemptRef.current++;
    const s = session;
    writeSaved(null);
    setSession(null);
    setAddress("");
    setChainId("");
    setError("");
    setPending(null);
    try {
      if (s?.kind === "injected") {
        // Lets MetaMask-style wallets ask again next time. Not all wallets support it.
        await s.provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
      } else {
        await s?.provider.disconnect?.();
      }
    } catch {
      /* best effort */
    }
  }, [session]);

  /** Raw wallet RPC. Used to switch to Arc and send the USDC approve + escrow deposit. */
  const request = useCallback(
    async (args: { method: string; params?: unknown[] | object }) => {
      const p = session?.provider;
      if (!p || !address) throw new Error("Connect a wallet first");
      return p.request(args);
    },
    [session, address],
  );

  const switchChain = useCallback(async () => {
    const p = session?.provider;
    if (!p) throw new Error("Connect a wallet first");
    await switchToArc(p.request.bind(p), session?.name);
    const c = await p.request({ method: "eth_chainId" }).catch(() => "");
    setChainId(toHexChain(c));
  }, [session]);

  /** personal_sign with the connected wallet (used for backend sign-in). */
  const signMessage = useCallback(
    async (message: string) => {
      const p = session?.provider;
      if (!p || !address) throw new Error("Connect a wallet first");
      const hexMsg = "0x" + Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, "0")).join("");
      let sig: unknown;
      try {
        sig = await p.request({ method: "personal_sign", params: [hexMsg, address] });
      } catch (e) {
        // A few wallets (older Trust / some WalletConnect bridges) want the plain string.
        if ((e as { code?: number }).code === 4001) throw e;
        sig = await p.request({ method: "personal_sign", params: [message, address] });
      }
      if (typeof sig !== "string" || !/^0x[0-9a-fA-F]+$/.test(sig)) throw new Error("Wallet returned no signature");
      return sig;
    },
    [session, address],
  );

  return {
    request,
    signMessage,
    switchChain,
    choices,
    address,
    chainId,
    onArc: chainIdNumber(chainId) === ARC.id,
    walletId: session?.id ?? "",
    walletName: session?.name ?? "",
    walletIcon: session?.icon ?? "",
    /** This wallet can't add the Arc network (see CATALOG.limited). */
    walletLimited: !!CATALOG.find((c) => c.id === session?.id)?.limited,
    walletBalance,
    pending,
    restoring,
    error,
    clearError: () => setError(""),
    connect,
    disconnect,
  };
}
