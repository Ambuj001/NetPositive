import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ORDERS, type Order } from './data'
import { CARDS, type Card } from './engine'
import {
  authenticate,
  readLocal,
  writeLocal,
  type AccountUser,
} from './account'
import {
  chainName,
  preloadConnectors,
  shortAddr,
  useWallet,
  type WalletChoice,
} from './wallet'
import type { WorkspaceOrder } from './trading'

type Toast = {
  id: number
  title: string
  body?: string
  tone?: 'mint' | 'amber' | 'iris' | 'rose'
}
type Ctx = {
  address: string | null
  fullAddress: string
  chain: string
  walletName: string
  walletIcon: string
  walletId: string
  choices: WalletChoice[]
  pending: string | null
  walletError: string
  balance: number
  humanVerified: boolean
  walletOpen: boolean
  orders: Order[]
  addPreviewVoucher: (draft: {
    merchantId: string
    name: string
    amount: number
    rate: number
  }) => string | null
  syncAssistantCards: (names: string[]) => void
  workspaceOrders: WorkspaceOrder[]
  saveWorkspaceOrder: (
    order: Omit<WorkspaceOrder, 'id' | 'owner' | 'status'>,
  ) => string | null
  cancelWorkspaceOrder: (id: string) => void
  toasts: Toast[]
  openWallet: () => void
  closeWallet: () => void
  connect: (w: WalletChoice) => Promise<boolean>
  disconnect: () => void
  username: string
  saveUsername: (name: string) => void
  cards: Card[]
  setCards: (cards: Card[]) => void
  token: string
  accountUser: AccountUser | null
  worldIdMock: boolean
  signIn: () => Promise<string>
  refreshUser: (user: AccountUser) => void
  toast: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
}
const AppCtx = createContext<Ctx | null>(null)
export function AppProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet()
  const owner = wallet.address.toLowerCase()
  const ownerRef = useRef(owner)
  ownerRef.current = owner
  const [walletOpen, setWalletOpen] = useState(false)
  const [workspaceOrders, setWorkspaceOrders] = useState<WorkspaceOrder[]>([])
  const [previewVouchers, setPreviewVouchers] = useState<
    (Order & { owner: string })[]
  >([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [profiles, setProfiles] = useState<Record<string, string>>(() =>
    readLocal('np.usernames.v1', {}),
  )
  const [portfolios, setPortfolios] = useState<Record<string, Card[]>>(() =>
    readLocal('np.portfolios.v1', {}),
  )
  const [session, setSession] = useState<{
    owner: string
    token: string
    user: AccountUser
    mock: boolean
  } | null>(null)
  useEffect(() => {
    setSession(null)
  }, [owner])
  const signedIn = session?.owner === owner ? session : null
  const dismiss = useCallback(
    (id: number) => setToasts((all) => all.filter((t) => t.id !== id)),
    [],
  )
  const toast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = Date.now() + Math.random()
      setToasts((all) => [...all.slice(-2), { ...t, id }])
      setTimeout(() => dismiss(id), 4200)
    },
    [dismiss],
  )
  const signIn = useCallback(async () => {
    if (!owner) throw new Error('Connect your wallet first.')
    const result = await authenticate(owner, wallet.signMessage)
    if (ownerRef.current !== owner)
      throw new Error('Wallet changed. Sign in again.')
    setSession({
      owner,
      token: result.token,
      user: result.user,
      mock: result.worldIdMock,
    })
    return result.token
  }, [owner, wallet.signMessage])
  const value = useMemo<Ctx>(
    () => ({
      address: owner ? shortAddr(owner) : null,
      fullAddress: owner,
      chain: chainName(wallet.chainId),
      walletName: wallet.walletName,
      walletIcon: wallet.walletIcon,
      walletId: wallet.walletId,
      choices: wallet.choices,
      pending: wallet.pending,
      walletError: wallet.error,
      balance: 120,
      humanVerified:
        !!signedIn?.user.worldIdNullifier &&
        !signedIn.user.banned &&
        !signedIn.mock,
      walletOpen,
      orders: [...previewVouchers.filter((o) => o.owner === owner), ...ORDERS],
      addPreviewVoucher: (draft) => {
        if (!owner) return null
        const id = `NP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
        setPreviewVouchers((all) => [
          {
            id,
            owner,
            brandId: draft.merchantId,
            brandName: draft.name,
            amount: draft.amount,
            rate: draft.rate,
            seller: 'you',
            sellerTrades: 0,
            city: '',
            postedMin: 0,
            expiresMin: 30,
            source: 'preview',
          },
          ...all,
        ])
        setWorkspaceOrders((all) => [
          {
            id,
            owner,
            mode: 'sell',
            type: 'market',
            amount: draft.amount,
            brandId: draft.merchantId,
            brandName: draft.name,
            matchedIds: [],
            status: 'open',
          },
          ...all,
        ])
        return id
      },
      syncAssistantCards: (names) => {
        const previous = portfolios[owner || 'guest'] ?? CARDS
        const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')
        const cards = names.map(
          (name) =>
            previous.find(
              (c) =>
                norm(`${c.issuer} ${c.name}`) === norm(name) ||
                norm(c.name) === norm(name),
            ) ?? {
              id: `assistant-${norm(name)}`,
              issuer: '',
              name,
              last: 'No local rate model',
              gradient: '',
              pointsPer: 0,
              spendUnit: 100,
              travelValue: 0,
              statementValue: 0,
              bonusCap: 0,
              bonusUsed: 0,
              channels: [],
            },
        )
        const next = { ...portfolios, [owner || 'guest']: cards }
        if (writeLocal('np.portfolios.v1', next)) setPortfolios(next)
      },
      workspaceOrders: workspaceOrders.filter((o) => o.owner === owner),
      saveWorkspaceOrder: (order) => {
        if (!owner) return null
        const id = `NP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
        setWorkspaceOrders((all) => [
          { ...order, id, owner, status: 'open' },
          ...all,
        ])
        return id
      },
      cancelWorkspaceOrder: (id) =>
        setWorkspaceOrders((all) =>
          all.map((o) =>
            o.id === id && o.owner === owner
              ? { ...o, status: 'cancelled' }
              : o,
          ),
        ),
      openWallet: () => {
        wallet.clearError()
        preloadConnectors()
        setWalletOpen(true)
      },
      closeWallet: () => setWalletOpen(false),
      connect: wallet.connect,
      disconnect: () => {
        setSession(null)
        wallet.disconnect()
      },
      username: profiles[owner] || '',
      saveUsername: (name) => {
        if (!owner) throw new Error('Connect your wallet first.')
        const normalized = name.trim()
        if (!/^[a-zA-Z0-9_]{3,24}$/.test(normalized))
          throw new Error('Use 3–24 letters, numbers, or underscores.')
        const next = { ...profiles, [owner]: normalized }
        if (!writeLocal('np.usernames.v1', next))
          throw new Error('Browser storage is unavailable.')
        setProfiles(next)
      },
      cards: portfolios[owner || 'guest'] ?? CARDS,
      setCards: (cards) => {
        const next = { ...portfolios, [owner || 'guest']: cards }
        if (!writeLocal('np.portfolios.v1', next))
          throw new Error('Browser storage is unavailable.')
        setPortfolios(next)
      },
      token: signedIn?.token || '',
      accountUser: signedIn?.user || null,
      worldIdMock: signedIn?.mock ?? true,
      signIn,
      refreshUser: (user) =>
        setSession((s) =>
          s && s.owner === owner && user.address.toLowerCase() === owner
            ? { ...s, user }
            : s,
        ),
      toasts,
      toast,
      dismiss,
    }),
    [
      owner,
      wallet,
      walletOpen,
      workspaceOrders,
      previewVouchers,
      profiles,
      portfolios,
      signedIn,
      signIn,
      toasts,
      toast,
      dismiss,
    ],
  )
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}
export function useApp() {
  const value = useContext(AppCtx)
  if (!value) throw new Error('useApp outside provider')
  return value
}
