import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

const CHAINS: Record<string, string> = {
  "0x1": "Ethereum",
  "0xaa36a7": "Sepolia",
  "0x2105": "Base",
  "0x14a34": "Base Sepolia",
  "0xa": "Optimism",
  "0xa4b1": "Arbitrum",
  "0x89": "Polygon",
  "0x38": "BNB Chain",
  "0x4cef52": "Arc Testnet",
};
export const chainName = (id: string) => (id ? CHAINS[id.toLowerCase()] ?? `Chain ${parseInt(id, 16)}` : "");
export const shortAddr = (a: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const isAddress = (v: unknown): v is string => typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v);

/** Balance shown on the connected-wallet chip. */
export type ChainBalance = { amount: number; symbol: string };

const ARC_CHAIN_ID = 5042002;

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
  [ARC_CHAIN_ID]: { symbol: "USDC", decimals: 18 },
};

function chainIdNumber(id: string) {
  if (!id) return 0;
  const n = id.startsWith("0x") || id.startsWith("0X") ? Number.parseInt(id, 16) : Number(id);
  return Number.isFinite(n) ? n : 0;
}

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
  if (id === ARC_CHAIN_ID) {
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
  /** What to do when the extension isn't installed. */
  fallback: Fallback;
  install?: string;
};

const CATALOG: CatalogEntry[] = [
  { id: "base", name: "Base", rdns: [], fallback: "base-sdk" },
  { id: "metamask", name: "MetaMask", rdns: ["io.metamask", "io.metamask.flask"], fallback: "install", install: "https://metamask.io/download/" },
  { id: "coinbase", name: "Coinbase Wallet", rdns: ["com.coinbase.wallet"], fallback: "coinbase-sdk" },
  { id: "rainbow", name: "Rainbow", rdns: ["me.rainbow"], fallback: "walletconnect", install: "https://rainbow.me/download" },
  { id: "rabby", name: "Rabby", rdns: ["io.rabby"], fallback: "install", install: "https://rabby.io/" },
  { id: "trust", name: "Trust Wallet", rdns: ["com.trustwallet.app"], fallback: "walletconnect", install: "https://trustwallet.com/download" },
  { id: "phantom", name: "Phantom", rdns: ["app.phantom"], fallback: "install", install: "https://phantom.com/download" },
  { id: "brave", name: "Brave Wallet", rdns: ["com.brave.wallet"], fallback: "install", install: "https://brave.com/wallet/" },
  { id: "walletconnect", name: "WalletConnect", rdns: [], fallback: "walletconnect" },
];

export type WalletStatus = "installed" | "popup" | "qr" | "install" | "unavailable";

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
  /** Installed extension provider, when present. */
  announced?: Announced;
  fallback: Fallback;
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
      appChainIds: [84532, 8453],
      preference: { telemetry: false },
    }).getProvider() as unknown as Provider;
  } else {
    const { createCoinbaseWalletSDK } = await import("@coinbase/wallet-sdk");
    sdkCache[kind] = createCoinbaseWalletSDK({
      appName: APP.name,
      appLogoUrl: APP.logo,
      appChainIds: [84532, 8453],
      preference: { options: "all" },
    }).getProvider() as unknown as Provider;
  }
  return sdkCache[kind]!;
}

async function loadWalletConnect(): Promise<Provider> {
  if (wcProvider) return wcProvider;
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  wcProvider = (await EthereumProvider.init({
    projectId: WC_PROJECT_ID,
    optionalChains: [84532, 8453, 1],
    showQrModal: true,
    metadata: {
      name: APP.name,
      description: "Spend crypto anywhere. Keep every reward.",
      url: window.location.origin,
      icons: [APP.logo],
    },
  })) as unknown as Provider;
  return wcProvider;
}

/** Warm SDK modules when the picker opens so popups aren't blocked. */
export function preloadConnectors() {
  void loadSdk("base-sdk").catch(() => {});
  void loadSdk("coinbase-sdk").catch(() => {});
}

/* ---------------------------------------------------------------- messages */

export function walletMessage(error: unknown) {
  const e = error as { code?: number; message?: string };
  if (e?.code === 4001 || /reject|denied|closed|cancel/i.test(e?.message ?? ""))
    return "You rejected the request in your wallet. Try again when you're ready.";
  if (e?.code === -32002) return "A request is already open. Check your wallet.";
  if (/popup/i.test(e?.message ?? "")) return "Your browser blocked the wallet popup. Allow popups for this site and try again.";
  return "Couldn't connect. Open your wallet and try again.";
}

/* -------------------------------------------------------------------- hook */

type Session = { id: string; name: string; icon?: string; provider: Provider; kind: "injected" | Fallback };

export function useWallet() {
  const [announced, setAnnounced] = useState<Announced[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [walletBalance, setWalletBalance] = useState<ChainBalance | null>(null);
  const attemptRef = useRef(0);

  // Discover installed extensions (EIP-6963), with a legacy window.ethereum fallback.
  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const w = (event as CustomEvent<Announced>).detail;
      if (!w?.info?.uuid || typeof w.provider?.request !== "function") return;
      setAnnounced((prev) => [...prev.filter((x) => x.info.uuid !== w.info.uuid && x.info.uuid !== "injected"), w]);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const t = setTimeout(() => {
      const provider = window.ethereum;
      if (!provider) return;
      setAnnounced((prev) =>
        prev.length
          ? prev
          : [{ info: { uuid: "injected", name: provider.isMetaMask ? "MetaMask" : "Browser wallet", rdns: provider.isMetaMask ? "io.metamask" : "" }, provider }],
      );
    }, 400);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(t);
    };
  }, []);

  // Build picker rows: catalog first, then any other installed extension.
  const choices = useMemo<WalletChoice[]>(() => {
    const used = new Set<string>();
    const rows: WalletChoice[] = CATALOG.map((c) => {
      const hit = announced.find((a) => a.info.rdns && c.rdns.includes(a.info.rdns));
      if (hit) {
        used.add(hit.info.uuid);
        return { id: c.id, name: c.name, icon: hit.info.icon, status: "installed", hint: "Installed", announced: hit, fallback: c.fallback, install: c.install };
      }
      const base = { id: c.id, name: c.name, fallback: c.fallback, install: c.install };
      if (c.fallback === "base-sdk") return { ...base, status: "popup", hint: "Base Account · passkey popup, no extension needed" };
      if (c.fallback === "coinbase-sdk") return { ...base, status: "popup", hint: "Extension or Coinbase popup" };
      if (c.fallback === "walletconnect")
        return WC_PROJECT_ID
          ? { ...base, status: "qr", hint: "Scan a QR code with your phone" }
          : { ...base, status: c.install ? "install" : "unavailable", hint: c.install ? "Not installed · get it" : "Needs a WalletConnect project ID" };
      return { ...base, status: "install", hint: "Not installed · get it" };
    });
    const others: WalletChoice[] = announced
      .filter((a) => !used.has(a.info.uuid))
      .map((a) => ({ id: a.info.uuid, name: a.info.name, icon: a.info.icon, status: "installed", hint: "Installed", announced: a, fallback: "install" }));
    // Installed first, keep catalog order otherwise.
    return [...rows.filter((r) => r.status === "installed"), ...others, ...rows.filter((r) => r.status !== "installed")];
  }, [announced]);

  // Live balance for the navbar. The 120 figure elsewhere is only the simulated escrow.
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
      if (isAddress(first)) setAddress(first);
      else {
        setAddress("");
        setChainId("");
        setSession(null);
      }
    };
    const onChain = (c: unknown) => {
      if (typeof c === "string") setChainId(c);
      else if (typeof c === "number") setChainId("0x" + c.toString(16));
    };
    const onDisconnect = () => {
      attemptRef.current++;
      setAddress("");
      setChainId("");
      setSession(null);
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
   * Opens the chosen wallet's own approval UI (extension popup, Base/Coinbase popup,
   * or WalletConnect QR). Resolves true when the user approves.
   */
  const connect = useCallback(async (choice: WalletChoice) => {
    if (choice.status === "install") {
      if (choice.install) window.open(choice.install, "_blank", "noopener,noreferrer");
      return false;
    }
    if (choice.status === "unavailable") {
      setError("WalletConnect needs a project ID. Add VITE_WALLETCONNECT_PROJECT_ID to .env and restart.");
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
      const chain = await provider.request({ method: "eth_chainId" });
      if (attempt !== attemptRef.current) return false;
      setSession({ id: choice.id, name: choice.name, icon: choice.icon, provider, kind });
      setAddress(first);
      setChainId(typeof chain === "string" ? chain : typeof chain === "number" ? "0x" + chain.toString(16) : "");
      return true;
    } catch (e) {
      if (attempt === attemptRef.current) setError(walletMessage(e));
      return false;
    } finally {
      if (attempt === attemptRef.current) setPending(null);
    }
  }, []);

  const disconnect = useCallback(async () => {
    attemptRef.current++;
    const s = session;
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

  /** personal_sign with the connected wallet (used for backend sign-in). */
  const signMessage = useCallback(
    async (message: string) => {
      const p = session?.provider;
      if (!p || !address) throw new Error("Connect a wallet first");
      const hexMsg = "0x" + Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, "0")).join("");
      const sig = await p.request({ method: "personal_sign", params: [hexMsg, address] });
      if (typeof sig !== "string" || !/^0x[0-9a-fA-F]+$/.test(sig)) throw new Error("Wallet returned no signature");
      return sig;
    },
    [session, address],
  );

  return {
    request,
    signMessage,
    choices,
    address,
    chainId,
    walletId: session?.id ?? "",
    walletName: session?.name ?? "",
    walletIcon: session?.icon ?? "",
    walletBalance,
    pending,
    error,
    clearError: () => setError(""),
    connect,
    disconnect,
  };
}
