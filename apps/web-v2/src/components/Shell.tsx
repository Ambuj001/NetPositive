import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ArrowUpRight, Check, ChevronRight, Copy, ExternalLink, FingerprintPattern, LoaderCircle, LogOut, Menu, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useIsAdmin } from "../lib/admin";
import { ARC, ARC_USDC } from "../lib/chain";
import { useApp } from "../lib/store";
import { readSession } from "../lib/session";
import { ON_MOBILE, formatChainBalance } from "../lib/wallet";
import { useRates, inr } from "../lib/rates";
import { WorldIdNotice, useWorldId } from "../lib/world";
import { CardsPrompt } from "./CardsPrompt";
import { Button, Logo, Mark, cx } from "./ui";
import { WalletLogo } from "./WalletLogos";

const APP_LINKS = [
  { to: "/trade", label: "Trade" },
  { to: "/market", label: "Market" },
  { to: "/cards", label: "My cards" },
  { to: "/track", label: "Orders" },
  { to: "/dispute", label: "Disputes" },
  { to: "/docs", label: "Docs" },
];
/** Shown only to administrator wallets (GET /admin/me). The server refuses everyone else on every admin route. */
const ADMIN_LINK = { to: "/admin", label: "Admin" };

const SITE_LINKS = [
  { to: "/#how", label: "How it works" },
  { to: "/#rates", label: "Live rates" },
  { to: "/#trust", label: "Trust" },
  { to: "/#faq", label: "FAQ" },
  { to: "/docs", label: "Docs" },
];

/** Pages that need a connected wallet. Everything else (landing, docs, terms, privacy, brand kit, 404) is public. */
const APP_PATHS = ["/trade", "/home", "/buy", "/spend", "/sell", "/track", "/market", "/cards", "/dispute", "/disputes", "/admin"];
export const isAppPath = (pathname: string) => APP_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export function Shell() {
  const { pathname, hash, key } = useLocation();
  const { walletOpen } = useApp();
  const lastPath = useRef<string | null>(null);
  // A link to a section scrolls to it, also when the same link is followed twice. A new page starts at the top.
  // `key` changes on every navigation, including ones that only change the query; those must not scroll.
  useEffect(() => {
    const moved = lastPath.current !== pathname;
    lastPath.current = pathname;
    if (hash) {
      let id = hash.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        /* a malformed % in the address: use it as typed */
      }
      const el = document.getElementById(id);
      if (el) {
        // Arriving from another page (or on a deep link) jumps straight there, and again once the fonts have
        // settled the layout. A link to a nearby section of the page you are on glides; a far one jumps, because
        // gliding through several screens of a long page is slow and shows blank tiles on phones.
        const far = Math.abs(el.getBoundingClientRect().top) > 1.5 * window.innerHeight;
        el.scrollIntoView({ behavior: moved || far ? "instant" : "smooth", block: "start" });
        if (moved) void document.fonts?.ready.then(() => el.isConnected && el.scrollIntoView({ behavior: "instant", block: "start" }));
        return;
      }
    }
    if (moved || hash) window.scrollTo({ top: 0 });
  }, [pathname, hash, key]);
  return (
    <div className="relative min-h-dvh overflow-x-clip bg-canvas">
      <Announcement />
      <Nav />
      <NetworkNotice />
      <HomeGate />
      {!walletOpen && <WorldIdNotice className="fixed bottom-5 left-5 z-[60] w-[min(380px,calc(100vw-40px))] shadow-[0_24px_60px_-20px_rgba(12,13,15,0.35)]" />}
      <main>
        <Gate />
      </main>
      <Footer />
      <FloatingCta />
      <WalletModal />
      <CardsPrompt />
      <Toaster />
    </div>
  );
}

/* ------------------------------------------------------------ top strip */

function Announcement() {
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem("np.announce") === "off";
    } catch {
      return false;
    }
  });
  const { data } = useRates();
  if (hidden) return null;
  const usdt = data?.assets?.USDT?.p2p?.buy?.price;
  return (
    <div className="relative z-[51] flex h-9 items-center justify-center gap-3 bg-sunken px-10 text-[13px] text-mute">
      <span className="hidden size-1.5 rounded-full bg-pos sm:inline-block" />
      <span className="min-w-0 truncate">
        {usdt ? (
          <>
            USDT on P2P is <span className="tabular font-medium text-fg">{inr(usdt)}</span> right now. See what an order is worth with your card.
          </>
        ) : (
          <>Get USDC for a gift voucher you buy on your card, paid by escrow to your own wallet.</>
        )}
      </span>
      <Link to="/docs" className="hidden shrink-0 items-center gap-1 font-medium text-fg hover:underline sm:inline-flex">
        How it works <ChevronRight className="size-3.5" />
      </Link>
      <button
        onClick={() => {
          setHidden(true);
          try {
            sessionStorage.setItem("np.announce", "off");
          } catch {
            /* ignore */
          }
        }}
        className="absolute right-3 grid size-6 place-items-center rounded-full text-dim hover:bg-sunken-2 hover:text-fg"
        aria-label="Dismiss"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ nav */

function Nav() {
  const { address, walletBalance, humanVerified, openWallet, walletIcon, walletId, walletName, restoring, onArc } = useApp();
  const { required: worldIdRequired } = useWorldId();
  const { admin } = useIsAdmin();
  const appLinks = admin ? [...APP_LINKS, ADMIN_LINK] : APP_LINKS;
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const inApp = isAppPath(pathname);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header className={cx("sticky top-0 z-50 bg-canvas/90 backdrop-blur-xl transition-[border-color] duration-300", scrolled ? "border-b border-line" : "border-b border-transparent")}>
      <nav className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-6 px-5 md:px-8">
        <Logo />
        <div className="hidden items-center gap-1 md:flex">
          {inApp && address
            ? appLinks.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  className={({ isActive }) =>
                    cx("relative rounded-lg px-3 py-2 text-[14.5px] transition-colors", isActive ? "text-fg" : "text-mute hover:text-fg")
                  }
                >
                  {({ isActive }) => (
                    <>
                      {l.label}
                      {isActive && <motion.span layoutId="nav-underline" className="absolute inset-x-3 -bottom-[13px] h-[2px] rounded-full bg-brand" />}
                    </>
                  )}
                </NavLink>
              ))
            : SITE_LINKS.map((l) => (
                <Link key={l.to} to={l.to} aria-current={pathname === l.to ? "page" : undefined} className={cx("rounded-lg px-3 py-2 text-[14.5px] transition-colors hover:text-fg", pathname === l.to ? "text-fg" : "text-mute")}>
                  {l.label}
                </Link>
              ))}
        </div>
        <div className="flex items-center gap-2">
          {address ? (
            <>
              {!inApp && (
                <Button size="sm" variant="outline" to="/trade" className="hidden sm:inline-flex">
                  Open app
                </Button>
              )}
              <button
                onClick={openWallet}
                className="flex items-center gap-2.5 rounded-full bg-surface py-1 pl-1 pr-3 ring-1 ring-line-2 transition hover:bg-sunken"
                data-testid="account-chip"
              >
                <WalletLogo id={walletId} icon={walletIcon} name={walletName || "W"} className="size-7" />
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block font-mono text-[11px] text-mute">{address}</span>
                  <span className="tabular block text-[12.5px] font-medium">{!onArc ? "Wrong network" : walletBalance ? formatChainBalance(walletBalance) : ARC.name}</span>
                </span>
                {humanVerified ? (
                  <ShieldCheck className="size-4 text-brand-ink" aria-label="Verified human" />
                ) : worldIdRequired ? (
                  <span className="size-2 rounded-full bg-amber" aria-label="World ID not verified" title="Not verified with World ID yet" />
                ) : null}
              </button>
            </>
          ) : (
            <Button size="sm" onClick={openWallet} disabled={restoring} icon={restoring ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}>
              {restoring ? "Reconnecting" : "Get started"}
            </Button>
          )}
          <button className="grid size-9 place-items-center rounded-full text-fg ring-1 ring-line md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden border-t border-line bg-canvas md:hidden">
            <div className="px-3 py-2">
              {(inApp && address ? appLinks : SITE_LINKS).map((l) => (
                <Link key={l.to} to={l.to} onClick={() => setOpen(false)} className="flex items-center justify-between rounded-xl px-3 py-3.5 text-[16px] hover:bg-sunken">
                  {l.label}
                  <ChevronRight className="size-4 text-dim" />
                </Link>
              ))}
              {address && !inApp && (
                <Link to="/trade" className="mt-1 flex items-center justify-between rounded-xl bg-fg px-3 py-3.5 text-[16px] text-white">
                  Open app <ArrowRight className="size-4" />
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

/* ------------------------------------------------------- wrong network */

/**
 * The wallet is connected but on another chain. Browsing still works; say so plainly and offer the switch. Every
 * escrow step also switches back by itself before it sends anything (see `switchToArc`).
 */
function NetworkNotice() {
  const { address, onArc, chain, switchToArc, walletLimited, walletName, toast } = useApp();
  const { pathname } = useLocation();
  const [busy, setBusy] = useState(false);
  if (!address || onArc || !chain || !isAppPath(pathname)) return null;
  return (
    <div role="status" className="border-b border-amber/30 bg-amber/10 px-5 py-2.5 text-[13px] text-amber-ink">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-4 gap-y-2 md:px-3">
        <span className="min-w-0">
          Your wallet is on {chain}. NetPositive's escrow runs on {ARC.name}
          {walletLimited ? `, which ${walletName} can't use. Connect another wallet to trade.` : ". Your next transaction will ask to switch back."}
        </span>
        {!walletLimited && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await switchToArc();
              } catch (e) {
                toast({ title: "Couldn't switch network", body: (e as Error)?.message?.slice(0, 260) || `Switch to ${ARC.name} in your wallet.`, tone: "rose" });
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-fg px-3 py-1 text-[12.5px] font-medium text-white disabled:opacity-60"
          >
            {busy && <LoaderCircle className="size-3 animate-spin" />}
            Switch to {ARC.name}
          </button>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- footer */

const REPO = "https://github.com/Ambuj001/NetPositive";

type FooterLink = { label: string; to: string } | { label: string; href: string };
const FOOTER_COLUMNS: { h: string; l: FooterLink[] }[] = [
  {
    h: "Product",
    l: [
      { label: "Trade", to: "/trade" },
      { label: "Market", to: "/market" },
      { label: "My cards", to: "/cards" },
      { label: "Orders", to: "/track" },
    ],
  },
  {
    h: "Docs",
    l: [
      { label: "How it works", to: "/docs" },
      { label: "Getting started", to: "/docs#getting-started" },
      { label: "Fees", to: "/docs#fees" },
      { label: "Disputes", to: "/docs#disputes" },
      { label: "Safety and known limits", to: "/docs#safety" },
      { label: "Common problems", to: "/docs#faq" },
    ],
  },
  {
    h: "More",
    l: [
      { label: "Contract details", to: "/docs#contract" },
      { label: "Terms", to: "/terms" },
      { label: "Privacy", to: "/privacy" },
      { label: "World ID", href: "https://world.org/world-id" },
      { label: "Source code", href: REPO },
    ],
  },
];

function Footer() {
  return (
    <footer className={cx("relative", useLocation().pathname === "/" ? "" : "mt-24 border-t border-line")}>
      <div className="mx-auto grid max-w-[1200px] grid-cols-3 gap-x-6 gap-y-10 px-5 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:px-8">
        <div className="col-span-3 md:col-span-1">
          <Logo />
          <div className="mt-5 flex items-center gap-2 text-[13px] font-medium text-fg">
            <span className="relative flex size-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-pos opacity-60" />
              <span className="relative size-2 rounded-full bg-pos" />
            </span>
            Escrow live on {ARC.name}
          </div>
          <p className="mt-3 max-w-xs text-[14px] leading-relaxed text-mute">Buy USDC with the card you already have, paid by escrow straight to your own wallet. Your reward points stay yours.</p>
          {!ARC.testnet && (
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-mute">
              The escrow contract is not audited yet and launch limits apply.{" "}
              <Link to="/docs#safety" className="link text-fg">
                Read the known limits
              </Link>
              .
            </p>
          )}
        </div>
        {FOOTER_COLUMNS.map((c) => (
          <div key={c.h}>
            <div className="mb-4 text-[14px] font-medium">{c.h}</div>
            <ul className="space-y-2.5 text-[14px] text-mute">
              {c.l.map((x) => (
                <li key={x.label}>
                  {"to" in x ? (
                    <Link to={x.to} className="transition hover:text-fg">
                      {x.label}
                    </Link>
                  ) : (
                    <a href={x.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 transition hover:text-fg">
                      {x.label}
                      <ArrowUpRight className="size-3 opacity-50" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-[1200px] flex-col justify-between gap-2 px-5 py-6 text-[12.5px] text-dim md:flex-row md:px-8">
        <span>© 2026 NetPositive. {ARC.testnet ? `Testnet software: no real money moves on ${ARC.name}.` : `Escrow runs on ${ARC.name}. USDC there is real money.`} Not financial advice.</span>
        <span className="flex flex-wrap gap-x-5 gap-y-1">
          <Link to="/terms" className="hover:text-fg">
            Terms
          </Link>
          <Link to="/privacy" className="hover:text-fg">
            Privacy
          </Link>
          <Link to="/brand" className="hover:text-fg">
            Brand kit
          </Link>
        </span>
      </div>
    </footer>
  );
}

/* --------------------------------------------------------- floating CTA */

function FloatingCta() {
  const { pathname } = useLocation();
  const { address, openWallet, walletOpen } = useApp();
  const [show, setShow] = useState(false);
  useEffect(() => {
    // Shown mid-page only: the blue band at the bottom has its own button.
    const on = () => setShow(window.scrollY > 520 && window.scrollY < document.documentElement.scrollHeight - window.innerHeight - 900);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  if (pathname !== "/" || walletOpen) return null;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          className="fixed bottom-5 right-5 z-[55] flex items-center gap-3 rounded-full bg-surface py-1.5 pl-5 pr-1.5 shadow-[0_12px_40px_-12px_rgba(12,13,15,0.35)] ring-1 ring-line"
        >
          <span className="hidden text-[14px] font-medium sm:inline">Ready to trade?</span>
          {address ? (
            <Button size="sm" to="/trade">
              Open app
            </Button>
          ) : (
            <Button size="sm" onClick={openWallet}>
              Connect wallet
            </Button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------------------------------------------------------- gates */

/**
 * Inside pages need a connected wallet. World ID is asked for the first time someone posts or accepts an order
 * (every such action calls ensureHuman), so a failed or cancelled World ID never locks a person out of browsing.
 * While an administrator has World ID switched off on the server, that step is skipped altogether.
 */
function Gate() {
  const { address, restoring } = useApp();
  const { pathname, search } = useLocation();
  const wasConnected = useRef(false);
  if (address) wasConnected.current = true;
  if (address || !isAppPath(pathname)) return <Outlet />;
  if (restoring)
    return (
      <div className="grid min-h-[60vh] place-items-center text-[14px] text-mute">
        <span className="flex items-center gap-2">
          <LoaderCircle className="size-4 animate-spin" /> Reconnecting your wallet…
        </span>
      </div>
    );
  // A wallet that was just disconnected goes home quietly. Anyone else is asked to connect, then sent on.
  return <Navigate to="/" replace state={wasConnected.current ? null : { from: pathname + search }} />;
}

/** Someone sent to the landing page by the gate gets the wallet sheet, and lands where they were headed once connected. */
function HomeGate() {
  const { address, openWallet } = useApp();
  const navigate = useNavigate();
  const { pathname, state } = useLocation();
  const askedRef = useRef(false);
  const from = typeof (state as { from?: unknown } | null)?.from === "string" ? (state as { from: string }).from : "";

  useEffect(() => {
    if (pathname !== "/" || !from) return;
    if (address) navigate(from, { replace: true });
    else if (!askedRef.current) {
      askedRef.current = true;
      openWallet();
    }
  }, [address, pathname, from, openWallet, navigate]);

  return null;
}

function waitForAddress(read: () => string) {
  const current = read();
  if (current) return Promise.resolve(current);
  return new Promise<string>((resolve) => {
    const started = performance.now();
    const tick = () => {
      const value = read();
      if (value) resolve(value);
      else if (performance.now() - started > 4000) resolve("");
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/* --------------------------------------------------------- wallet sheet */

function WalletModal() {
  const app = useApp();
  const { walletOpen, closeWallet, address, fullAddress, chain, walletName, walletIcon, walletId, choices, pending, walletError, connect, disconnect, humanVerified, toast, onArc, switchToArc, walletLimited, walletRequest } = app;
  const appRef = useRef(app);
  appRef.current = app;
  const { verifyHuman, phase, config, required: worldIdRequired, refreshConfig } = useWorldId();
  const { admin } = useIsAdmin();
  const [copied, setCopied] = useState(false);
  const [switching, setSwitching] = useState(false);
  const navigate = useNavigate();
  const { pathname, state } = useLocation();

  const addressRef = useRef(fullAddress);
  addressRef.current = fullAddress;

  useEffect(() => {
    if (!walletOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeWallet();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [walletOpen, closeWallet]);

  const doConnect = async (w: (typeof choices)[number]) => {
    const ok = await connect(w);
    if (!ok) return;
    toast({ title: "Wallet connected", body: `${w.name} approved NetPositive.`, tone: "mint" });
    const addr = await waitForAddress(() => addressRef.current);
    if (!addr) return;
    // One flow: sign in (one free signature), then Proof of Human once. Cancelling World ID still lets them in to browse.
    // With World ID switched off on the server, only the sign-in is left.
    const stored = readSession(addr);
    const cfg = await refreshConfig();
    if (!cfg.required) {
      if (!stored) await appRef.current.signIn();
    } else if (!stored?.verified) await verifyHuman();
    closeWallet();
    const from = typeof (state as { from?: unknown } | null)?.from === "string" ? (state as { from: string }).from : "";
    if (pathname === "/") navigate(from || "/trade");
  };

  const staging = config?.environment === "staging" && !config?.bypass;

  return (
    <AnimatePresence>
      {walletOpen && (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-end bg-fg/30 backdrop-blur-[3px] sm:place-items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={closeWallet}
        >
          <motion.div
            role="dialog"
            aria-modal
            aria-label="Wallet"
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="relative max-h-[92dvh] w-full max-w-full overflow-x-hidden overflow-y-auto rounded-t-[24px] bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_40px_120px_-30px_rgba(12,13,15,0.45)] ring-1 ring-line sm:max-w-[420px] sm:rounded-[24px]"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-2.5">
                <Mark className="size-6 shrink-0" />
                <h3 className="truncate text-[17px] font-semibold tracking-[-0.02em]">{address ? "Your account" : "Connect a wallet"}</h3>
              </div>
              <button onClick={closeWallet} className="grid size-9 shrink-0 place-items-center rounded-full text-mute hover:bg-sunken hover:text-fg" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>

            {!address ? (
              <div className="p-3 pt-3 sm:p-4 sm:pt-3">
                {ON_MOBILE && !choices.some((c) => c.status === "installed") && (
                  <p className="mx-2 mb-1 rounded-xl bg-sunken px-3 py-2.5 text-[12.5px] leading-relaxed text-mute">
                    Phone browsers don't have a wallet built in. Open this page inside your wallet app, then connect there.
                  </p>
                )}
                <div className="max-h-[min(460px,56dvh)] space-y-1 overflow-x-hidden overflow-y-auto pr-1" data-testid="wallet-list">
                  {choices.map((w, i) => {
                    const waiting = pending === w.id;
                    const prev = choices[i - 1];
                    const group = (s: typeof w.status) => (s === "installed" ? 0 : s === "app" ? 1 : 2);
                    const header =
                      prev && group(prev.status) === group(w.status)
                        ? null
                        : w.status === "installed"
                          ? "Detected in this browser"
                          : w.status === "app"
                            ? "Open in wallet app"
                            : i === 0
                              ? "Choose a wallet"
                              : "More ways to connect";
                    const tag =
                      w.status === "installed"
                        ? { t: "Ready", c: "text-brand-ink bg-brand-soft" }
                        : w.status === "popup"
                          ? { t: "Popup", c: "text-iris bg-iris/8" }
                          : w.status === "qr"
                            ? { t: ON_MOBILE ? "Connect" : "QR", c: "text-iris bg-iris/8" }
                            : w.status === "app"
                              ? { t: "Open", c: "text-brand-ink bg-brand-soft" }
                            : w.status === "install"
                              ? { t: "Get", c: "text-mute bg-sunken" }
                              : { t: "Dev", c: "text-amber-ink bg-amber/12" };
                    return (
                      <div key={w.id}>
                        {header && <div className={cx("px-2 pb-1.5 text-[12px] font-medium text-dim", i > 0 ? "pt-4" : "pt-2")}>{header}</div>}
                        <button
                          disabled={!!pending}
                          onClick={() => doConnect(w)}
                          data-testid={`wallet-${w.id}`}
                          className={cx(
                            "flex min-h-[56px] w-full min-w-0 items-center gap-3 rounded-2xl p-2.5 pr-3 text-left transition hover:bg-sunken disabled:cursor-wait",
                            waiting && "bg-sunken ring-1 ring-brand",
                            pending && !waiting && "opacity-40",
                          )}
                        >
                          <WalletLogo id={w.id} name={w.name} icon={w.icon} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-medium">{w.name}</span>
                            <span className={cx("block truncate text-[12.5px]", waiting ? "text-brand-ink" : "text-dim")}>
                              {waiting ? (w.status === "qr" ? (ON_MOBILE ? "Choose your wallet app…" : "Scan the QR code with your phone…") : `Approve in ${w.name}…`) : w.hint}
                            </span>
                          </span>
                          {waiting ? (
                            <LoaderCircle className="size-4 shrink-0 animate-spin text-brand-ink" />
                          ) : (
                            <span className={cx("flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", tag.c)}>
                              {tag.t}
                              {(w.status === "install" || w.status === "app") && <ArrowUpRight className="size-3" />}
                            </span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {walletError && (
                  <p role="alert" className="mt-3 rounded-xl bg-rose/8 px-3.5 py-2.5 text-[13px] text-rose-ink ring-1 ring-rose/20">
                    {walletError}
                  </p>
                )}
                <p className="px-2 pt-4 pb-1 text-center text-[12.5px] text-dim">
                  Any EVM wallet works. Your keys never leave it. New to wallets?{" "}
                  <a className="link" href="https://ethereum.org/en/wallets/find-wallet/" target="_blank" rel="noopener noreferrer">
                    Find one
                  </a>
                </p>
              </div>
            ) : (
              <div className="space-y-3 p-4 sm:p-5">
                <div className="rounded-2xl bg-sunken p-4">
                  <div className="flex items-center gap-3">
                    <WalletLogo id={walletId} icon={walletIcon} name={walletName} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-medium">{walletName}</div>
                      <div className="truncate font-mono text-[12.5px] text-mute" title={fullAddress}>
                        {address}
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(fullAddress);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1600);
                        } catch {
                          /* clipboard blocked */
                        }
                      }}
                      className="grid size-8 place-items-center rounded-full bg-surface text-mute ring-1 ring-line transition hover:text-fg"
                      aria-label="Copy address"
                    >
                      {copied ? <Check className="size-3.5 text-brand-ink" /> : <Copy className="size-3.5" />}
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line pt-3 text-[13px]">
                    <span className="flex min-w-0 items-center gap-2 text-mute">
                      <span className={cx("size-2 shrink-0 rounded-full", onArc ? "bg-pos" : "bg-amber")} />
                      <span className="truncate">{chain || "Unknown network"}</span>
                    </span>
                    {!onArc ? (
                      <button
                        disabled={switching}
                        data-testid="switch-arc"
                        onClick={async () => {
                          setSwitching(true);
                          try {
                            await switchToArc();
                            toast({ title: `On ${ARC.name}`, body: "Escrow deposits use this network.", tone: "mint" });
                          } catch (e) {
                            toast({ title: "Couldn't switch network", body: (e as Error)?.message?.slice(0, 260) || `Switch to ${ARC.name} in your wallet.`, tone: "rose" });
                          } finally {
                            setSwitching(false);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-full bg-fg px-3 py-1 text-[12.5px] font-medium text-white disabled:opacity-60"
                      >
                        {switching && <LoaderCircle className="size-3 animate-spin" />}
                        Switch to {ARC.name}
                      </button>
                    ) : (
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <button
                          onClick={async () => {
                            try {
                              // EIP-747: asks the wallet to list Arc USDC so a payout shows up in the token list.
                              await walletRequest({ method: "wallet_watchAsset", params: { type: "ERC20", options: { address: ARC_USDC, symbol: "USDC", decimals: 6 } } });
                            } catch {
                              toast({ title: "Your wallet didn't add the token", body: `On ${ARC.name}, USDC is also the gas coin, so most wallets already show it as the main balance.`, tone: "amber" });
                            }
                          }}
                          className="text-mute hover:text-fg"
                        >
                          Show USDC in wallet
                        </button>
                        <a href={`${ARC.explorer}/address/${fullAddress}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-mute hover:text-fg">
                          Explorer <ExternalLink className="size-3" />
                        </a>
                      </span>
                    )}
                  </div>
                  {walletLimited && (
                    <p className="mt-3 rounded-xl bg-amber/12 px-3 py-2.5 text-[12.5px] leading-relaxed text-amber-ink">
                      {walletName} can sign in and verify, but it can't use {ARC.name}. USDC paid to this address on {ARC.name} won't show up in {walletName}, and it can't lock USDC. For trading, connect MetaMask, Rabby, Coinbase Wallet or OKX Wallet.
                    </p>
                  )}
                </div>

                {!worldIdRequired ? (
                  <div className="rounded-2xl bg-surface p-4 text-[13px] leading-relaxed text-mute ring-1 ring-line" data-testid="world-id-off">
                    <div className="text-[15px] font-medium text-fg">No World ID step right now</div>
                    <div className="mt-0.5">World ID is switched off on NetPositive at the moment. A signed-in wallet can post and accept orders without it.</div>
                  </div>
                ) : (
                <div className={cx("rounded-2xl p-4 ring-1", humanVerified ? "bg-brand-soft ring-brand/30" : "bg-surface ring-line")}>
                  <div className="flex items-start gap-3">
                    <div className={cx("grid size-10 shrink-0 place-items-center rounded-full", humanVerified ? "bg-brand text-white" : "bg-fg text-white")}>
                      {humanVerified ? <Check className="size-5" /> : <FingerprintPattern className="size-5" />}
                    </div>
                    <div className="flex-1">
                      <div className="text-[15px] font-medium">{humanVerified ? "Verified human" : "Verify you're a unique human"}</div>
                      <div className="mt-0.5 text-[13px] leading-relaxed text-mute">
                        {humanVerified
                          ? "Proof of Human is bound to this wallet. One person, one account."
                          : "One World ID check, bound to this wallet. You can browse without it; posting and accepting orders need it."}
                      </div>
                    </div>
                  </div>
                  {!humanVerified && (
                    <>
                      <button
                        onClick={() => void verifyHuman()}
                        disabled={phase !== "idle"}
                        data-testid="verify-world-id"
                        className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-fg text-[14.5px] font-medium text-white transition hover:bg-[#25272c] disabled:opacity-60"
                      >
                        {phase !== "idle" ? (
                          <>
                            <LoaderCircle className="size-4 animate-spin" /> {phase === "world" ? "Waiting for World App…" : "Check your wallet to sign in…"}
                          </>
                        ) : (
                          <>
                            <span className="grid size-5 place-items-center rounded-full border-2 border-white">
                              <span className="size-1.5 rounded-full bg-white" />
                            </span>
                            Verify with World ID
                          </>
                        )}
                      </button>
                      {config?.bypass && <p className="mt-2.5 text-center text-[12px] text-amber-ink">Local dev mode: the server skips the World App step.</p>}
                      {staging && (
                        <p className="mt-2.5 text-center text-[12px] text-mute">
                          Test mode: scan the code with the{" "}
                          <a className="link" href="https://simulator.worldcoin.org" target="_blank" rel="noopener noreferrer">
                            World ID Simulator
                          </a>
                          , not the World App.
                        </p>
                      )}
                    </>
                  )}
                  <WorldIdNotice className="mt-3" />
                </div>
                )}

                {admin && (
                  <Link
                    to={ADMIN_LINK.to}
                    onClick={closeWallet}
                    className="flex items-center gap-3 rounded-2xl bg-surface p-3.5 text-[14px] ring-1 ring-line transition hover:bg-sunken"
                    data-testid="admin-link"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sunken">
                      <SlidersHorizontal className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">Admin</span>
                      <span className="block truncate text-[12.5px] text-mute">World ID switch, orders, disputes, server health</span>
                    </span>
                    <ChevronRight className="size-4 text-dim" />
                  </Link>
                )}

                <div className="flex flex-wrap gap-2">
                  {pathname === "/" && (
                    <Button className="flex-1" to="/trade" onClick={closeWallet}>
                      Open app
                    </Button>
                  )}
                  <button onClick={disconnect} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-[14px] text-mute ring-1 ring-line transition hover:bg-sunken hover:text-rose-ink">
                    <LogOut className="size-4" /> Disconnect
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* --------------------------------------------------------------- toasts */

function Toaster() {
  const { toasts, dismiss } = useApp();
  const dot = { mint: "bg-brand", amber: "bg-amber", iris: "bg-iris", rose: "bg-rose" };
  return (
    <div className="pointer-events-none fixed top-20 right-5 z-[80] flex w-[340px] max-w-[calc(100vw-40px)] flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            className="pointer-events-auto flex gap-3 rounded-2xl bg-surface p-4 shadow-[0_20px_50px_-16px_rgba(12,13,15,0.3)] ring-1 ring-line"
            onClick={() => dismiss(t.id)}
            role="status"
          >
            <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", dot[t.tone ?? "mint"])} />
            <div>
              <div className="text-[14px] font-medium">{t.title}</div>
              {t.body && <div className="mt-0.5 text-[13px] text-mute">{t.body}</div>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
