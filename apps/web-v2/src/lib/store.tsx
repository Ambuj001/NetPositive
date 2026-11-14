import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, api, type ApiUser } from "./api";
import type { Card as CardT } from "./engine";
import { useSavedCards } from "./useSavedCards";
import { clearSession, readSession, writeSession } from "./session";
import { clearVaultSession } from "./vault";
import { chainName, preloadConnectors, shortAddr, useWallet, type ChainBalance, type WalletChoice } from "./wallet";

type Toast = { id: number; title: string; body?: string; tone?: "mint" | "amber" | "iris" | "rose" };

type Ctx = {
  /** Shortened address of the connected wallet, or null. */
  address: string | null;
  fullAddress: string;
  chain: string;
  walletName: string;
  walletIcon: string;
  walletId: string;
  /** The connected wallet can't add the Arc network, so it can sign in but not use the escrow. */
  walletLimited: boolean;
  choices: WalletChoice[];
  pending: string | null;
  walletError: string;
  /** True while the last-used wallet is being silently reconnected after a reload. */
  restoring: boolean;
  /** True when the wallet is on the configured Arc network, where the escrow lives. */
  onArc: boolean;
  /** Ask the wallet to switch to (or add) the configured Arc network. */
  switchToArc: () => Promise<void>;
  /** USDC (or native coin) actually held by the connected wallet. */
  walletBalance: ChainBalance | null;
  /** True once the server has bound a World ID nullifier to this wallet. */
  humanVerified: boolean;
  /** JWT from POST /auth/verify, if this wallet has signed in. */
  token: string | null;
  walletOpen: boolean;
  toasts: Toast[];
  apiUser: ApiUser | null;
  signingIn: boolean;
  signIn: () => Promise<string | null>;
  openWallet: () => void;
  closeWallet: () => void;
  connect: (w: WalletChoice) => Promise<boolean>;
  disconnect: () => void;
  signMessage: (message: string) => Promise<string>;
  /** Connected wallet RPC, for the Arc USDC approve and escrow deposit. */
  walletRequest: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  applySession: (address: string, token: string, verified: boolean) => void;
  /** Saved card reward profiles (issuer, variant, rates). Never card numbers. Saved per wallet in this browser. */
  cards: CardT[];
  setCards: (next: CardT[]) => void;
  /** True once this wallet's saved cards have been read from the server. */
  cardsLoaded: boolean;
  /** True once they closed the "add your cards" pop-up (kept on the server, so it follows them). */
  cardsPromptDismissed: boolean;
  dismissCardsPrompt: () => void;
  toast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
};

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const [humanVerified, setHuman] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [apiUser, setApiUser] = useState<ApiUser | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const sessionGen = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((all) => [...all.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), 4200);
    },
    [dismiss],
  );
  // Saved cards: in Firestore when signed in, in this browser otherwise.
  const { cards, setCards, cardsLoaded, cardsPromptDismissed, dismissCardsPrompt } = useSavedCards({ address: wallet.address, token, toast });

  const applySession = useCallback((address: string, nextToken: string, verified: boolean) => {
    sessionGen.current += 1;
    writeSession(address, { token: nextToken, verified });
    setToken(nextToken);
    setHuman(verified);
  }, []);

  // One session for World ID and the tracker. Drop it when the wallet changes.
  // The vault private key is memory-only and belongs to the previous wallet, so it goes too.
  useEffect(() => {
    clearVaultSession();
    const addr = wallet.address;
    setApiUser(null);
    if (!addr) {
      setToken(null);
      setHuman(false);
      return;
    }
    const stored = readSession(addr);
    if (!stored) {
      setToken(null);
      setHuman(false);
      return;
    }
    setToken(stored.token);
    setHuman(stored.verified);
    const gen = sessionGen.current;
    let cancel = false;
    api
      .me(stored.token)
      .then((res) => {
        if (cancel || gen !== sessionGen.current) return;
        const verified = !!res.user.worldIdNullifier;
        writeSession(addr, { token: stored.token, verified });
        setApiUser(res.user);
        setHuman(verified);
      })
      .catch((error: unknown) => {
        if (cancel || gen !== sessionGen.current) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          clearSession(addr);
          setToken(null);
          setApiUser(null);
          setHuman(false);
        }
      });
    return () => {
      cancel = true;
    };
  }, [wallet.address]);

  /** Wallet sign-in with the backend: nonce → personal_sign → JWT. Shares the World ID session. */
  const signIn = useCallback(async () => {
    if (!wallet.address) return null;
    setSigningIn(true);
    try {
      const { message } = await api.nonce(wallet.address);
      const signature = await wallet.signMessage(message);
      const r = await api.verify(wallet.address, signature);
      sessionGen.current += 1;
      const verified = !!r.user.worldIdNullifier;
      writeSession(wallet.address, { token: r.token, verified });
      setToken(r.token);
      setApiUser(r.user);
      setHuman(verified);
      toast({ title: "Signed in", body: "Your orders are loading from NetPositive.", tone: "mint" });
      return r.token;
    } catch (e) {
      const msg = (e as { code?: number })?.code === 4001 ? "You rejected the signature request." : e instanceof Error ? e.message : "Sign-in failed.";
      toast({ title: "Couldn't sign in", body: msg, tone: "rose" });
      return null;
    } finally {
      setSigningIn(false);
    }
  }, [wallet, toast]);

  const value = useMemo<Ctx>(
    () => ({
      address: wallet.address ? shortAddr(wallet.address) : null,
      fullAddress: wallet.address,
      chain: chainName(wallet.chainId),
      walletName: wallet.walletName,
      walletIcon: wallet.walletIcon,
      walletId: wallet.walletId,
      walletLimited: wallet.walletLimited,
      choices: wallet.choices,
      pending: wallet.pending,
      walletError: wallet.error,
      restoring: wallet.restoring,
      onArc: wallet.onArc,
      switchToArc: wallet.switchChain,
      walletBalance: wallet.walletBalance,
      humanVerified: humanVerified || !!apiUser?.worldIdNullifier,
      token,
      walletOpen,
      toasts,
      apiUser,
      signingIn,
      signIn,
      openWallet: () => {
        wallet.clearError();
        preloadConnectors();
        setWalletOpen(true);
      },
      closeWallet: () => setWalletOpen(false),
      connect: wallet.connect,
      disconnect: () => {
        if (wallet.address) clearSession(wallet.address);
        clearVaultSession();
        setToken(null);
        setHuman(false);
        setApiUser(null);
        wallet.disconnect();
      },
      signMessage: wallet.signMessage,
      walletRequest: wallet.request,
      applySession,
      cards,
      setCards,
      cardsLoaded,
      cardsPromptDismissed,
      dismissCardsPrompt,
      toast,
      dismiss,
    }),
    [wallet, humanVerified, token, walletOpen, toasts, apiUser, signingIn, signIn, toast, dismiss, applySession, cards, setCards, cardsLoaded, cardsPromptDismissed, dismissCardsPrompt],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}
