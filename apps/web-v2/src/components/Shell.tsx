import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Check, ChevronRight, Copy, FingerprintPattern, LoaderCircle, Menu, ShieldCheck, Wallet, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useApp } from "../lib/store";
import { usdt } from "../lib/engine";
import { Button, Logo, cx } from "./ui";
import { WalletLogo } from "./WalletLogos";

const APP_LINKS = [
  { to: "/trade", label: "Trade" },
  { to: "/market", label: "Market" },
  { to: "/cards", label: "My cards" },
];

export function Shell() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <div className="noise" />
      <Nav />
      <main>
        <Outlet />
      </main>
      <Footer />
      <WalletModal />
      <Toaster />
    </div>
  );
}

function Nav() {
  const { address, restoring, balance, humanVerified, openWallet, walletIcon, walletId, walletName } = useApp();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const links = APP_LINKS;
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4">
      <motion.nav
        initial={{ y: -30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className={cx(
          "flex w-full max-w-6xl items-center justify-between rounded-full py-2 pl-4 pr-2 transition-all duration-500",
          scrolled ? "glass shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]" : "bg-transparent",
        )}
      >
        <Logo />
        <div className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                cx(
                  "relative rounded-full px-3.5 py-2 text-[13.5px] transition-colors",
                  isActive ? "text-fg" : "text-mute hover:text-fg",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-white/[0.07] ring-1 ring-white/10" />
                  )}
                  <span className="relative">{l.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {address ? (
            <button
              onClick={openWallet}
              className="flex items-center gap-2.5 rounded-full bg-white/[0.04] py-1.5 pl-1.5 pr-3.5 ring-1 ring-white/10 transition hover:bg-white/[0.08]"
            >
              <WalletLogo id={walletId} icon={walletIcon} name={walletName || "W"} className="size-7" />
              <span className="hidden text-left leading-tight sm:block">
                <span className="block font-mono text-[11px] text-mute">{address}</span>
                <span className="tabular block text-[12.5px] font-medium">{usdt(balance)} USDC</span>
              </span>
              {humanVerified && <ShieldCheck className="size-4 text-mint" aria-label="Verified human" />}
            </button>
          ) : restoring ? (
            <span className="flex h-9 items-center gap-2 rounded-full bg-white/[0.04] px-3.5 text-[12.5px] text-mute ring-1 ring-white/10" aria-live="polite">
              <LoaderCircle className="size-3.5 animate-spin" /> Reconnecting
            </span>
          ) : (
            <Button size="sm" onClick={openWallet} icon={<Wallet className="size-3.5" />}>
              Connect
            </Button>
          )}
          <button className={cx("grid size-9 place-items-center rounded-full text-mute md:hidden", !links.length && "hidden")} onClick={() => setOpen((o) => !o)} aria-label="Menu">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </motion.nav>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="glass absolute inset-x-4 top-20 rounded-3xl p-2 md:hidden"
          >
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} className="flex items-center justify-between rounded-2xl px-4 py-3.5 text-[15px] hover:bg-white/5">
                {l.label}
                <ChevronRight className="size-4 text-dim" />
              </NavLink>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function Footer() {
  return (
    <footer className="relative mt-32 border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-[13.5px] leading-relaxed text-mute">
            Shop with crypto through gift vouchers. Card holders earn the crypto and keep every reward point.
          </p>
          <div className="mt-6 flex items-center gap-2">
            <span className="label">Built at</span>
            <span className="rounded-md bg-white/5 px-2 py-1 font-mono text-[11px] ring-1 ring-white/10">ETHGlobal Mumbai · 2026</span>
          </div>
        </div>
        {[
          { h: "Product", l: ["Trade", "Market", "Pay with crypto", "My cards"] },
          { h: "Trust", l: ["Escrow contract", "World ID", "Verification layer", "Dispute reserve"] },
          { h: "Build", l: ["Docs", "Contracts", "GitHub", "Brand kit"] },
        ].map((c) => (
          <div key={c.h}>
            <div className="label mb-4">{c.h}</div>
            <ul className="space-y-2.5 text-[13.5px] text-mute">
              {c.l.map((x) => (
                <li key={x} className="cursor-default transition hover:text-fg">
                  {x}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-6xl flex-col justify-between gap-2 border-t border-line px-6 py-6 text-[12px] text-dim md:flex-row">
        <span>Hackathon prototype. Contracts unaudited. Demo data shown.</span>
        <span className="font-mono">escrow · world id · signed voucher checks</span>
      </div>
      <div aria-hidden className="pointer-events-none select-none overflow-hidden">
        <div className="text-gradient -mb-[4vw] text-center font-display text-[18vw] font-bold leading-none tracking-[-0.06em] opacity-[0.06]">
          NETPOSITIVE
        </div>
      </div>
    </footer>
  );
}

function WalletModal() {
  const { walletOpen, closeWallet, address, fullAddress, chain, walletName, walletIcon, walletId, choices, pending, walletError, connect, disconnect, humanVerified, verifyHuman, toast } =
    useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const doConnect = async (w: (typeof choices)[number]) => {
    const ok = await connect(w);
    if (ok) {
      toast({ title: "Wallet connected", body: `${w.name} approved this site`, tone: "mint" });
      closeWallet();
    }
  };
  const doVerify = () => {
    setBusy("world");
    setTimeout(() => {
      verifyHuman();
      setBusy(null);
      toast({ title: "Verified human", body: "World ID proof accepted. One person, one account.", tone: "iris" });
    }, 1800);
  };

  return (
    <AnimatePresence>
      {walletOpen && (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4 backdrop-blur-md"
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
            initial={{ y: 30, scale: 0.96, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 20, scale: 0.97, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="hairline relative w-full max-w-[400px] overflow-hidden rounded-[28px] bg-ink-2 p-6 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)]"
          >
            <div className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(61,220,151,0.18),transparent)]" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-xl font-semibold tracking-tight">{address ? "Your account" : "Connect wallet"}</h3>
                <button onClick={closeWallet} className="grid size-8 place-items-center rounded-full text-mute hover:bg-white/5 hover:text-fg" aria-label="Close">
                  <X className="size-4" />
                </button>
              </div>

              {!address ? (
                <div className="mt-5">
                  <div className="-mr-2 max-h-[min(440px,60vh)] space-y-1.5 overflow-y-auto pr-2">
                    {choices.map((w, i) => {
                      const waiting = pending === w.id;
                      const prev = choices[i - 1];
                      const header =
                        i === 0 && w.status === "installed"
                          ? "Installed in this browser"
                          : w.status !== "installed" && (!prev || prev.status === "installed")
                            ? "More wallets"
                            : null;
                      const tag =
                        w.status === "installed"
                          ? { t: "Installed", c: "text-mint bg-mint/10 ring-mint/25" }
                          : w.status === "popup"
                            ? { t: "Popup", c: "text-iris bg-iris/10 ring-iris/25" }
                            : w.status === "qr"
                              ? { t: "QR code", c: "text-iris bg-iris/10 ring-iris/25" }
                              : w.status === "install"
                                ? { t: "Get", c: "text-mute bg-white/[0.04] ring-white/10" }
                                : { t: "Setup", c: "text-amber bg-amber/10 ring-amber/25" };
                      return (
                        <div key={w.id}>
                          {header && <div className={cx("label mb-2", i > 0 && "mt-4")}>{header}</div>}
                          <button
                            disabled={!!pending}
                            onClick={() => doConnect(w)}
                            className={cx(
                              "flex w-full items-center gap-3 rounded-2xl bg-white/[0.03] p-2.5 pr-3 ring-1 transition hover:bg-white/[0.07] hover:ring-white/15 disabled:cursor-wait",
                              waiting ? "ring-mint/40" : "ring-white/[0.06]",
                              pending && !waiting && "opacity-40",
                            )}
                          >
                            <WalletLogo id={w.id} name={w.name} icon={w.icon} />
                            <span className="min-w-0 flex-1 text-left">
                              <span className="block text-[14px] font-medium">{w.name}</span>
                              <span className={cx("block truncate text-[11.5px]", waiting ? "text-mint" : "text-dim")}>
                                {waiting ? (w.status === "qr" ? "Scan the QR code with your phone…" : `Approve the request in ${w.name}…`) : w.hint}
                              </span>
                            </span>
                            {waiting ? (
                              <LoaderCircle className="size-4 animate-spin text-mint" />
                            ) : (
                              <span className={cx("flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9.5px] tracking-wider uppercase ring-1", tag.c)}>
                                {tag.t}
                                {w.status === "install" && <ArrowUpRight className="size-2.5" />}
                              </span>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {walletError && (
                    <p role="alert" className="mt-3 rounded-xl bg-rose/[0.08] px-3.5 py-2.5 text-[12.5px] text-rose ring-1 ring-rose/25">
                      {walletError}
                    </p>
                  )}
                  <p className="pt-4 text-center text-[12px] text-dim">Your wallet asks you to approve. Keys never leave your wallet.</p>
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  <div className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/[0.06]">
                    <div className="flex items-center gap-3">
                      <WalletLogo id={walletId} icon={walletIcon} name={walletName} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[14.5px] font-medium">{walletName}</div>
                        <div className="truncate font-mono text-[12px] text-mute" title={fullAddress}>
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
                        className="grid size-8 place-items-center rounded-full text-mute ring-1 ring-white/10 transition hover:text-fg"
                        aria-label="Copy address"
                      >
                        {copied ? <Check className="size-3.5 text-mint" /> : <Copy className="size-3.5" />}
                      </button>
                    </div>
                    <div className="mt-3 flex items-center gap-1.5 text-[12px] text-mute">
                      <span className="size-1.5 rounded-full bg-mint" /> {chain || "Unknown network"}
                    </div>
                  </div>

                  <div className={cx("rounded-2xl p-4 ring-1", humanVerified ? "bg-mint/[0.06] ring-mint/25" : "bg-iris/[0.06] ring-iris/25")}>
                    <div className="flex items-start gap-3">
                      <div className={cx("grid size-10 place-items-center rounded-full", humanVerified ? "bg-mint/15 text-mint" : "bg-iris/15 text-iris")}>
                        {humanVerified ? <Check className="size-5" /> : <FingerprintPattern className="size-5" />}
                      </div>
                      <div className="flex-1">
                        <div className="text-[14.5px] font-medium">{humanVerified ? "Verified human" : "Prove you're human"}</div>
                        <div className="mt-0.5 text-[12.5px] leading-relaxed text-mute">
                          {humanVerified
                            ? "World ID nullifier bound to this account. Banned accounts can't come back."
                            : "World ID, once. Every trader is one real person, so scammers can't make a new account."}
                        </div>
                      </div>
                    </div>
                    {!humanVerified && (
                      <button
                        onClick={doVerify}
                        disabled={!!busy}
                        className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white text-[14px] font-medium text-ink transition hover:bg-white/90"
                      >
                        {busy === "world" ? (
                          <>
                            <LoaderCircle className="size-4 animate-spin" /> Waiting for World App…
                          </>
                        ) : (
                          <>
                            <span className="grid size-5 place-items-center rounded-full border-2 border-ink">
                              <span className="size-1.5 rounded-full bg-ink" />
                            </span>
                            Verify with World ID
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  <button onClick={disconnect} className="w-full rounded-full py-2.5 text-[13px] text-mute transition hover:bg-white/5 hover:text-rose">
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Toaster() {
  const { toasts, dismiss } = useApp();
  const dot = { mint: "bg-mint", amber: "bg-amber", iris: "bg-iris", rose: "bg-rose" };
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[80] flex w-[340px] max-w-[calc(100vw-40px)] flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            className="glass pointer-events-auto flex gap-3 rounded-2xl p-4 shadow-[0_20px_50px_-10px_rgba(0,0,0,0.8)]"
            onClick={() => dismiss(t.id)}
          >
            <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", dot[t.tone ?? "mint"])} />
            <div>
              <div className="text-[13.5px] font-medium">{t.title}</div>
              {t.body && <div className="mt-0.5 text-[12.5px] text-mute">{t.body}</div>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
