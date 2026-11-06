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

  return {
    choices,
    address,
    chainId,
    walletId: session?.id ?? "",
    walletName: session?.name ?? "",
    walletIcon: session?.icon ?? "",
    pending,
    error,
    clearError: () => setError(""),
    connect,
    disconnect,
  };
}
