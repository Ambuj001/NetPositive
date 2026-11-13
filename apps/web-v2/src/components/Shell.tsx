import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ArrowUpRight, Check, ChevronRight, Copy, ExternalLink, FingerprintPattern, LoaderCircle, LogOut, Menu, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../lib/store";
import { readSession } from "../lib/session";
import { formatChainBalance } from "../lib/wallet";
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
];

const SITE_LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#rates", label: "Live rates" },
  { href: "/#trust", label: "Trust" },
  { href: "/#faq", label: "FAQ" },
];

export function Shell() {
  const { pathname, hash } = useLocation();
  const { walletOpen } = useApp();
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    window.scrollTo({ top: 0 });
  }, [pathname, hash]);
  return (
    <div className="relative min-h-dvh overflow-x-clip bg-canvas">
      <Announcement />
      <Nav />
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
      <span className="truncate">
        {usdt ? (
          <>
            USDT on P2P right now <span className="tabular font-medium text-fg">{inr(usdt)}</span>. Get more for your USDC with a voucher trade.
          </>
        ) : (
          <>Spend USDC at Amazon, Flipkart, Myntra, Swiggy and more.</>
        )}
      </span>
      <a href="/#how" className="hidden shrink-0 items-center gap-1 font-medium text-fg hover:underline sm:inline-flex">
        How it works <ChevronRight className="size-3.5" />
      </a>
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
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const inApp = pathname !== "/" && pathname !== "/brand";
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
            ? APP_LINKS.map((l) => (
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
                <a key={l.href} href={l.href} className="rounded-lg px-3 py-2 text-[14.5px] text-mute transition-colors hover:text-fg">
                  {l.label}
                </a>
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
                  <span className="tabular block text-[12.5px] font-medium">{walletBalance ? formatChainBalance(walletBalance) : onArc ? "Arc" : "Connected"}</span>
                </span>
                {humanVerified ? (
                  <ShieldCheck className="size-4 text-brand-ink" aria-label="Verified human" />
                ) : (
                  <span className="size-2 rounded-full bg-amber" aria-label="World ID not verified" title="Not verified with World ID yet" />
                )}
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
              {(inApp && address ? APP_LINKS.map((l) => ({ href: l.to, label: l.label, internal: true })) : SITE_LINKS.map((l) => ({ ...l, internal: false }))).map((l) =>
                l.internal ? (
                  <NavLink key={l.href} to={l.href} className="flex items-center justify-between rounded-xl px-3 py-3.5 text-[16px] hover:bg-sunken">
                    {l.label}
                    <ChevronRight className="size-4 text-dim" />
                  </NavLink>
                ) : (
                  <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="flex items-center justify-between rounded-xl px-3 py-3.5 text-[16px] hover:bg-sunken">
                    {l.label}
                    <ChevronRight className="size-4 text-dim" />
                  </a>
                ),
              )}
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

/* --------------------------------------------------------------- footer */

const REPO = "https://github.com/Ambuj001/NetPositive";
const REPO_FILE = `${REPO}/blob/main`;
const REPO_DIR = `${REPO}/tree/main`;

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
    h: "Trust",
    l: [
      { label: "Escrow contract", href: `${REPO_FILE}/contracts/src/VoucherEscrow.sol` },
      { label: "World ID", href: "https://world.org/world-id" },
      { label: "Voucher vault", href: `${REPO_FILE}/docs/vault.md` },
      { label: "Disputes", to: "/dispute" },
    ],
  },
  {
    h: "Build",
    l: [
      { label: "Docs", href: `${REPO_DIR}/docs` },
      { label: "Contracts", href: `${REPO_DIR}/contracts` },
      { label: "Rates API", href: `${REPO_FILE}/backend/README.md` },
      { label: "GitHub", href: REPO },
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
            Escrow live on Arc Testnet
          </div>
          <p className="mt-3 max-w-xs text-[14px] leading-relaxed text-mute">Spend crypto at the stores you already use. Card holders fill the order and keep every reward point.</p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-sunken px-3 py-1.5 font-mono text-[11px] text-mute">Built at ETHGlobal Mumbai · 2026</div>
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
        <span>© 2026 NetPositive. Testnet software: no real money moves on Arc Testnet. Not financial advice.</span>
        <Link to="/brand" className="hover:text-fg">
          Brand kit
        </Link>
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
 * (every such action calls verifyHuman), so a failed or cancelled World ID never locks a person out of browsing.
 */
function Gate() {
  const { address, restoring } = useApp();
  const { pathname, search } = useLocation();
  const wasConnected = useRef(false);
  if (address) wasConnected.current = true;
  if (address || pathname === "/" || pathname === "/brand") return <Outlet />;
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
  const { walletOpen, closeWallet, address, fullAddress, chain, walletName, walletIcon, walletId, choices, pending, walletError, connect, disconnect, humanVerified, toast, onArc, switchToArc } = app;
  const appRef = useRef(app);
  appRef.current = app;
  const { verifyHuman, phase, config } = useWorldId();
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
    if (!readSession(addr)?.verified) await verifyHuman();
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
            className="relative w-full overflow-hidden rounded-t-[24px] bg-surface shadow-[0_40px_120px_-30px_rgba(12,13,15,0.45)] ring-1 ring-line sm:max-w-[420px] sm:rounded-[24px]"
          >
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <div className="flex items-center gap-2.5">
                <Mark className="size-6" />
                <h3 className="text-[17px] font-semibold tracking-[-0.02em]">{address ? "Your account" : "Connect a wallet"}</h3>
              </div>
              <button onClick={closeWallet} className="grid size-8 place-items-center rounded-full text-mute hover:bg-sunken hover:text-fg" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>

            {!address ? (
              <div className="p-4 pt-3">
                <div className="max-h-[min(460px,62vh)] space-y-1 overflow-y-auto pr-1" data-testid="wallet-list">
                  {choices.map((w, i) => {
                    const waiting = pending === w.id;
                    const prev = choices[i - 1];
                    const header =
                      i === 0 && w.status === "installed"
                        ? "Detected in this browser"
                        : w.status !== "installed" && (!prev || prev.status === "installed")
                          ? i === 0
                            ? "Choose a wallet"
                            : "More wallets"
                          : null;
                    const tag =
                      w.status === "installed"
                        ? { t: "Ready", c: "text-brand-ink bg-brand-soft" }
                        : w.status === "popup"
                          ? { t: "Popup", c: "text-iris bg-iris/8" }
                          : w.status === "qr"
                            ? { t: "QR", c: "text-iris bg-iris/8" }
                            : w.status === "install"
                              ? { t: "Get", c: "text-mute bg-sunken" }
                              : { t: "Setup", c: "text-amber-ink bg-amber/12" };
                    return (
                      <div key={w.id}>
                        {header && <div className={cx("px-2 pb-1.5 text-[12px] font-medium text-dim", i > 0 ? "pt-4" : "pt-2")}>{header}</div>}
                        <button
                          disabled={!!pending}
                          onClick={() => doConnect(w)}
                          data-testid={`wallet-${w.id}`}
                          className={cx(
                            "flex w-full items-center gap-3 rounded-2xl p-2.5 pr-3 text-left transition hover:bg-sunken disabled:cursor-wait",
                            waiting && "bg-sunken ring-1 ring-brand",
                            pending && !waiting && "opacity-40",
                          )}
                        >
                          <WalletLogo id={w.id} name={w.name} icon={w.icon} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-medium">{w.name}</span>
                            <span className={cx("block truncate text-[12.5px]", waiting ? "text-brand-ink" : "text-dim")}>
                              {waiting ? (w.status === "qr" ? "Scan the QR code with your phone…" : `Approve in ${w.name}…`) : w.hint}
                            </span>
                          </span>
                          {waiting ? (
                            <LoaderCircle className="size-4 animate-spin text-brand-ink" />
                          ) : (
                            <span className={cx("flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", tag.c)}>
                              {tag.t}
                              {w.status === "install" && <ArrowUpRight className="size-3" />}
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
              <div className="space-y-3 p-5">
                <div className="rounded-2xl bg-sunken p-4">
                  <div className="flex items-center gap-3">
                    <WalletLogo id={walletId} icon={walletIcon} name={walletName} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-medium">{walletName}</div>
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
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3 text-[13px]">
                    <span className="flex items-center gap-2 text-mute">
                      <span className={cx("size-2 rounded-full", onArc ? "bg-pos" : "bg-amber")} />
                      {chain || "Unknown network"}
                    </span>
                    {!onArc ? (
                      <button
                        disabled={switching}
                        data-testid="switch-arc"
                        onClick={async () => {
                          setSwitching(true);
                          try {
                            await switchToArc();
                            toast({ title: "On Arc Testnet", body: "Escrow deposits use this network.", tone: "mint" });
                          } catch (e) {
                            toast({ title: "Couldn't switch network", body: (e as Error)?.message?.slice(0, 120) || "Switch to Arc Testnet in your wallet.", tone: "rose" });
                          } finally {
                            setSwitching(false);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-full bg-fg px-3 py-1 text-[12.5px] font-medium text-white disabled:opacity-60"
                      >
                        {switching && <LoaderCircle className="size-3 animate-spin" />}
                        Switch to Arc
                      </button>
                    ) : (
                      <a href={`https://testnet.arcscan.app/address/${fullAddress}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-mute hover:text-fg">
                        Explorer <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                </div>

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

                <div className="flex gap-2">
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
