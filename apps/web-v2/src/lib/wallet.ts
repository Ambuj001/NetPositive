import { useCallback, useEffect, useRef, useState } from "react";

/** Minimal EIP-1193 provider surface. */
export type Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
};

/** EIP-6963 announced wallet. */
export type WalletOption = {
  info: { uuid: string; name: string; icon?: string; rdns?: string };
  provider: Provider;
};

declare global {
  interface Window {
    ethereum?: Provider;
  }
}

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

export function walletMessage(error: unknown) {
  const code = (error as { code?: number })?.code;
  if (code === 4001) return "You rejected the request in your wallet. Try again when you're ready.";
  if (code === -32002) return "A request is already open. Check your wallet extension.";
  return "Couldn't connect. Open your wallet extension and try again.";
}

/**
 * Real browser-wallet connection.
 * Discovers every installed extension via EIP-6963, falls back to window.ethereum,
 * and asks the chosen wallet for permission with eth_requestAccounts.
 */
export function useWallet() {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [selected, setSelected] = useState<WalletOption | null>(null);
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const attemptRef = useRef(0);

  // Discover installed wallets
  useEffect(() => {
    const announce = (event: Event) => {
      const w = (event as CustomEvent<WalletOption>).detail;
      if (!w?.info?.uuid || typeof w.provider?.request !== "function") return;
      setWallets((prev) => [...prev.filter((x) => x.info.uuid !== w.info.uuid && x.info.uuid !== "injected"), w]);
    };
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // Legacy fallback for wallets that only inject window.ethereum
    const t = setTimeout(() => {
      if (!window.ethereum) return;
      const provider = window.ethereum;
      setWallets((prev) =>
        prev.length ? prev : [{ info: { uuid: "injected", name: provider.isMetaMask ? "MetaMask" : "Browser wallet" }, provider }],
      );
    }, 400);
    return () => {
      window.removeEventListener("eip6963:announceProvider", announce);
      clearTimeout(t);
    };
  }, []);

  // Follow account / network changes made inside the extension
  useEffect(() => {
    const p = selected?.provider;
    if (!p) return;
    const onAccounts = (accounts: unknown) => {
      const first = Array.isArray(accounts) ? accounts[0] : undefined;
      if (isAddress(first)) setAddress(first);
      else {
        setAddress("");
        setSelected(null);
        setChainId("");
      }
    };
    const onChain = (c: unknown) => typeof c === "string" && setChainId(c);
    const onDisconnect = () => {
      attemptRef.current++;
      setAddress("");
      setChainId("");
      setSelected(null);
    };
    p.on?.("accountsChanged", onAccounts);
    p.on?.("chainChanged", onChain);
    p.on?.("disconnect", onDisconnect);
    return () => {
      p.removeListener?.("accountsChanged", onAccounts);
      p.removeListener?.("chainChanged", onChain);
      p.removeListener?.("disconnect", onDisconnect);
    };
  }, [selected]);

  /** Opens the wallet's own approval popup. Resolves true when the user approves. */
  const connect = useCallback(async (w: WalletOption) => {
    const attempt = ++attemptRef.current;
    setPending(w.info.uuid);
    setError("");
    try {
      const accounts = await w.provider.request({ method: "eth_requestAccounts" });
      const first = Array.isArray(accounts) ? accounts[0] : undefined;
      if (!isAddress(first)) throw new Error("Wallet returned no account");
      const chain = await w.provider.request({ method: "eth_chainId" });
      if (attempt !== attemptRef.current) return false;
      setSelected(w);
      setAddress(first);
      setChainId(typeof chain === "string" ? chain : "");
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
    const p = selected?.provider;
    setSelected(null);
    setAddress("");
    setChainId("");
    setError("");
    setPending(null);
    // Best effort: lets MetaMask ask again on the next connect. Not all wallets support it.
    try {
      await p?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    } catch {
      /* ignore */
    }
  }, [selected]);

  return {
    wallets,
    address,
    chainId,
    walletName: selected?.info.name ?? "",
    walletIcon: selected?.info.icon ?? "",
    pending,
    error,
    clearError: () => setError(""),
    connect,
    disconnect,
  };
}
