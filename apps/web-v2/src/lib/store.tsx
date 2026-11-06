import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ORDERS, type Order } from "./data";
import { chainName, shortAddr, useWallet, type WalletOption } from "./wallet";

type Toast = { id: number; title: string; body?: string; tone?: "mint" | "amber" | "iris" | "rose" };

type Ctx = {
  /** Shortened address of the connected wallet, or null. */
  address: string | null;
  fullAddress: string;
  chain: string;
  walletName: string;
  walletIcon: string;
  wallets: WalletOption[];
  pending: string | null;
  walletError: string;
  /** Demo USDT balance used by the simulated escrow (not read from chain). */
  balance: number;
  humanVerified: boolean;
  walletOpen: boolean;
  orders: Order[];
  toasts: Toast[];
  openWallet: () => void;
  closeWallet: () => void;
  connect: (w: WalletOption) => Promise<boolean>;
  disconnect: () => void;
  verifyHuman: () => void;
  postOrder: (o: Omit<Order, "id" | "postedMin" | "expiresMin" | "seller" | "sellerTrades" | "city">, lock: number) => Order;
  toast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
};

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const [balance, setBalance] = useState(120);
  const [humanVerified, setHuman] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>(ORDERS);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((all) => [...all.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), 4200);
    },
    [dismiss],
  );

  const value = useMemo<Ctx>(
    () => ({
      address: wallet.address ? shortAddr(wallet.address) : null,
      fullAddress: wallet.address,
      chain: chainName(wallet.chainId),
      walletName: wallet.walletName,
      walletIcon: wallet.walletIcon,
      wallets: wallet.wallets,
      pending: wallet.pending,
      walletError: wallet.error,
      balance,
      humanVerified,
      walletOpen,
      orders,
      toasts,
      openWallet: () => {
        wallet.clearError();
        setWalletOpen(true);
      },
      closeWallet: () => setWalletOpen(false),
      connect: wallet.connect,
      disconnect: () => {
        wallet.disconnect();
        setHuman(false);
      },
      verifyHuman: () => setHuman(true),
      postOrder: (o, lock) => {
        const id = `VR-${24818 + Math.floor(Math.random() * 80)}`;
        const order: Order = { ...o, id, postedMin: 0, expiresMin: 30, seller: "you", sellerTrades: 14, city: "Bengaluru" };
        setOrders((all) => [order, ...all]);
        setBalance((b) => Math.round((b - lock) * 100) / 100);
        return order;
      },
      toast,
      dismiss,
    }),
    [wallet, balance, humanVerified, walletOpen, orders, toasts, toast, dismiss],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}
