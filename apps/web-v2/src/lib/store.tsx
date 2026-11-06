import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, type ApiUser, type ReqStatus } from "./api";
import { ORDERS, type Order } from "./data";
import { chainName, preloadConnectors, shortAddr, useWallet, type WalletChoice } from "./wallet";

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
  humanVerified: boolean;
  walletOpen: boolean;
  orders: Order[];
  myOrders: LocalOrder[];
  toasts: Toast[];
  /** Backend session (wallet sign-in). */
  token: string | null;
  apiUser: ApiUser | null;
  signingIn: boolean;
  signIn: () => Promise<string | null>;
  openWallet: () => void;
  closeWallet: () => void;
  connect: (w: WalletChoice) => Promise<boolean>;
  disconnect: () => void;
  verifyHuman: () => void;
  postOrder: (o: Omit<Order, "id" | "postedMin" | "expiresMin" | "seller" | "sellerTrades" | "city">, lock: number) => Order;
  /** Records that I'm filling this order (adds it to the local book if it came from the API). */
  acceptOrder: (o: Order) => void;
  toast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
};

const AppCtx = createContext<Ctx | null>(null);
const TOKEN_KEY = (addr: string) => `netpositive:token:${addr.toLowerCase()}`;

export function AppProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const [balance, setBalance] = useState(120);
  const [humanVerified, setHuman] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>(ORDERS);
  const [myOrders, setMyOrders] = useState<LocalOrder[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [apiUser, setApiUser] = useState<ApiUser | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((all) => [...all.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), 4200);
    },
    [dismiss],
  );

  // Restore a saved backend token for this wallet; drop it when the wallet changes.
  useEffect(() => {
    setApiUser(null);
    if (!wallet.address) return setToken(null);
    const saved = sessionStorage.getItem(TOKEN_KEY(wallet.address));
    setToken(saved);
    if (saved)
      api
        .me(saved)
        .then((r) => setApiUser(r.user))
        .catch((e) => {
          if (e instanceof ApiError && e.status === 401) {
            sessionStorage.removeItem(TOKEN_KEY(wallet.address));
            setToken(null);
          }
        });
  }, [wallet.address]);

  /** Wallet sign-in with the backend: nonce → personal_sign → JWT. */
  const signIn = useCallback(async () => {
    if (!wallet.address) return null;
    setSigningIn(true);
    try {
      const { message } = await api.nonce(wallet.address);
      const signature = await wallet.signMessage(message);
      const r = await api.verify(wallet.address, signature);
      sessionStorage.setItem(TOKEN_KEY(wallet.address), r.token);
      setToken(r.token);
      setApiUser(r.user);
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
      humanVerified: humanVerified || !!apiUser?.worldIdNullifier,
      walletOpen,
      orders,
      myOrders,
      toasts,
      token,
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
        if (wallet.address) sessionStorage.removeItem(TOKEN_KEY(wallet.address));
        wallet.disconnect();
        setHuman(false);
        setToken(null);
        setApiUser(null);
      },
      verifyHuman: () => setHuman(true),
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
      toast,
      dismiss,
    }),
    [wallet, balance, humanVerified, walletOpen, orders, myOrders, toasts, token, apiUser, signingIn, signIn, toast, dismiss],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}
