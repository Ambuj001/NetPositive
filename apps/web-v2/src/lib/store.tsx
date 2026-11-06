import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, api, type ApiUser, type ReqStatus } from "./api";
import { ORDERS, type Order } from "./data";
import type { Card as CardT } from "./engine";
import { useSavedCards } from "./useSavedCards";
import { clearSession, readSession, writeSession } from "./session";
import { chainName, preloadConnectors, shortAddr, useWallet, type ChainBalance, type WalletChoice } from "./wallet";

type Toast = { id: number; title: string; body?: string; tone?: "mint" | "amber" | "iris" | "rose" };

/** An order created in this browser session (shown on Track when the backend isn't connected). */
export type LocalOrder = Order & { status: ReqStatus; role: "requester" | "fulfiller"; createdAt: string };

type Ctx = {
  /** Shortened address of the connected wallet, or null. */
  address: string | null;
  fullAddress: string;
  chain: string;
  walletName: string;
  walletIcon: string;
  walletId: string;
  choices: WalletChoice[];
  pending: string | null;
  walletError: string;
  /** Demo USDC balance used by the simulated escrow (not read from chain). */
  balance: number;
  /** USDC (or native coin) actually held by the connected wallet. */
  walletBalance: ChainBalance | null;
  /** True once the server has bound a World ID nullifier to this wallet. */
  humanVerified: boolean;
  /** JWT from POST /auth/verify, if this wallet has signed in. */
  token: string | null;
  walletOpen: boolean;
  orders: Order[];
  myOrders: LocalOrder[];
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
  postOrder: (o: Omit<Order, "id" | "postedMin" | "expiresMin" | "seller" | "sellerTrades" | "city">, lock: number) => Order;
  /** Records that I'm filling this order (adds it to the local book if it came from the API). */
  /** Saved card reward profiles (issuer, variant, rates). Never card numbers. Saved per wallet in this browser. */
  cards: CardT[];
  setCards: (next: CardT[]) => void;
  /** True once this wallet's saved cards have been read from the server. */
  cardsLoaded: boolean;
  /** True once they closed the "add your cards" pop-up (kept on the server, so it follows them). */
  cardsPromptDismissed: boolean;
  dismissCardsPrompt: () => void;
  acceptOrder: (o: Order) => void;
  toast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
};

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const [balance, setBalance] = useState(120);
  const [humanVerified, setHuman] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>(ORDERS);
  const [myOrders, setMyOrders] = useState<LocalOrder[]>([]);
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
  useEffect(() => {
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
      choices: wallet.choices,
      pending: wallet.pending,
      walletError: wallet.error,
      balance,
      walletBalance: wallet.walletBalance,
      humanVerified: humanVerified || !!apiUser?.worldIdNullifier,
      token,
      walletOpen,
      orders,
      myOrders,
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
        setToken(null);
        setHuman(false);
        setApiUser(null);
        wallet.disconnect();
      },
      signMessage: wallet.signMessage,
      walletRequest: wallet.request,
      applySession,
      postOrder: (o, lock) => {
        const id = `VR-${24818 + Math.floor(Math.random() * 80)}`;
        const order: Order = { ...o, id, postedMin: 0, expiresMin: 30, seller: "you", sellerTrades: 14, city: "Bengaluru" };
        setOrders((all) => [order, ...all]);
        setMyOrders((all) => [{ ...order, status: "open", role: "requester", createdAt: new Date().toISOString() }, ...all]);
        setBalance((b) => Math.round((b - lock) * 100) / 100);
        return order;
      },
      acceptOrder: (o) => {
        setOrders((all) => (all.some((x) => x.id === o.id) ? all : [o, ...all]));
        setMyOrders((all) =>
          all.some((x) => x.id === o.id) ? all : [{ ...o, status: "accepted", role: "fulfiller", createdAt: new Date().toISOString() }, ...all],
        );
      },
      cards,
      setCards,
      cardsLoaded,
      cardsPromptDismissed,
      dismissCardsPrompt,
      toast,
      dismiss,
    }),
    [wallet, balance, humanVerified, token, walletOpen, orders, myOrders, toasts, apiUser, signingIn, signIn, toast, dismiss, applySession, cards, setCards, cardsLoaded, cardsPromptDismissed, dismissCardsPrompt],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}
