import { AnimatePresence, motion } from "motion/react";
import { Check, Lock, Plus, Smartphone, X } from "lucide-react";
import { useState } from "react";
import { Aurora, Button, Card, Pill, Tilt, cx } from "../components/ui";
import { CARDS, inr, routesFor, type Card as CardT } from "../lib/engine";
import { useApp } from "../lib/store";

const CATALOG = [
  { issuer: "HDFC", name: "Diners Club Black", gradient: "from-[#101114] via-[#23252c] to-[#050607]" },
  { issuer: "ICICI", name: "Emeralde Private", gradient: "from-[#06291f] via-[#0d4a37] to-[#03140f]" },
  { issuer: "Amex", name: "Platinum Travel", gradient: "from-[#8c8f96] via-[#c3c6cc] to-[#55585e]" },
  { issuer: "Axis", name: "Atlas", gradient: "from-[#2b1240] via-[#4a2270] to-[#14081f]" },
];

export default function Cards() {
  const { toast } = useApp();
  const [cards, setCards] = useState<CardT[]>(CARDS);
  const [sel, setSel] = useState(CARDS[0].id);
  const [adding, setAdding] = useState(false);
  const card = cards.find((c) => c.id === sel) ?? cards[0];
  const best = routesFor(10000, [card])[0];
  const capPct = card.bonusCap ? ((card.bonusCap - card.bonusUsed) / card.bonusCap) * 100 : 0;

  const add = (c: (typeof CATALOG)[number]) => {
    const n: CardT = {
      id: c.name.toLowerCase().replace(/\s/g, "-"),
      issuer: c.issuer,
      name: c.name,
      last: "",
      gradient: c.gradient,
      pointsPer: 4,
      spendUnit: 150,
      travelValue: 1,
      statementValue: 0.3,
      bonusCap: 2000,
      bonusUsed: 0,
      channels: [{ id: "portal", name: `${c.issuer} portal 3X`, multiplier: 3, denomination: 5000, note: "Bank rewards portal" }],
    };
    setCards((all) => (all.some((x) => x.id === n.id) ? all : [...all, n]));
    setSel(n.id);
    setAdding(false);
    toast({ title: `${c.name} saved on this device`, body: "Issuer and variant only. No card number.", tone: "amber" });
  };

  return (
    <div className="relative pt-32">
      <Aurora className="h-[50vh] opacity-50" />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <Pill tone="amber">Card portfolio</Pill>
            <h1 className="mt-5 font-display text-4xl font-semibold tracking-[-0.03em] md:text-5xl">Your cards, ranked for every order</h1>
            <p className="mt-3 max-w-xl text-[15.5px] text-mute">Stored only in this browser. We keep the issuer, variant and caps you've used. Never a card number, never a CVV.</p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl bg-white/[0.03] px-4 py-3 text-[12.5px] text-mute ring-1 ring-white/[0.07]">
            <Smartphone className="size-4 text-amber" /> Local storage · encrypted
            <Lock className="size-3.5 text-dim" />
          </div>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <div className="relative grid place-items-center py-6">
              <div className="absolute inset-10 rounded-full bg-amber/10 blur-[80px]" />
              <AnimatePresence mode="wait">
                <motion.div key={card.id} initial={{ opacity: 0, rotateY: -30, y: 20 }} animate={{ opacity: 1, rotateY: 0, y: 0 }} exit={{ opacity: 0, rotateY: 30 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="w-full max-w-[440px]">
                  <Tilt max={12}>
                    <BigCard c={card} />
                  </Tilt>
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="mt-6 flex gap-3 overflow-x-auto pb-2 scrollbar-none">
              {cards.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSel(c.id)}
                  className={cx("relative aspect-[1.586] w-36 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br p-3 text-left ring-1 transition", c.gradient, sel === c.id ? "ring-amber/70" : "opacity-60 ring-white/10 hover:opacity-100")}
                >
                  <div className="font-mono text-[9px] uppercase tracking-widest text-white/50">{c.issuer}</div>
                  <div className="absolute bottom-3 left-3 text-[12px] font-medium">{c.name}</div>
                </button>
              ))}
              <button onClick={() => setAdding(true)} className="grid aspect-[1.586] w-36 shrink-0 place-items-center rounded-xl border border-dashed border-white/15 text-mute transition hover:border-amber/50 hover:text-amber">
                <span className="flex items-center gap-1.5 text-[12.5px]">
                  <Plus className="size-4" /> Add card
                </span>
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <Card glow="rgba(245,181,68,0.1)" className="p-6">
              <div className="label">Earn rate</div>
              <div className="mt-2 font-display text-3xl font-semibold tracking-tight">
                {card.pointsPer} pts <span className="text-lg text-mute">per {inr(card.spendUnit)}</span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/[0.06]">
                <div className="bg-ink-2 p-4">
                  <div className="label">Travel value</div>
                  <div className="mt-1 text-[17px] font-semibold">₹{card.travelValue.toFixed(2)}/pt</div>
                </div>
                <div className="bg-ink-2 p-4">
                  <div className="label">Statement</div>
                  <div className="mt-1 text-[17px] font-semibold">₹{card.statementValue.toFixed(2)}/pt</div>
                </div>
              </div>
            </Card>
            {card.bonusCap > 0 && (
              <Card className="p-6">
                <div className="flex items-center justify-between">
                  <span className="label">Bonus cap this month</span>
                  <span className="text-[13px] tabular">
                    {(card.bonusCap - card.bonusUsed).toLocaleString("en-IN")} / {card.bonusCap.toLocaleString("en-IN")} left
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                  <motion.div key={card.id} className="h-full rounded-full bg-gradient-to-r from-amber to-[#ffd78a]" initial={{ width: 0 }} animate={{ width: `${capPct}%` }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} />
                </div>
                <p className="mt-3 text-[12px] text-dim">Updated locally after each purchase. Resets on the 1st.</p>
              </Card>
            )}
            <Card className="p-6">
              <div className="label mb-3">Channels</div>
              <div className="space-y-2">
                {card.channels.map((ch) => (
                  <div key={ch.id} className="flex items-center justify-between rounded-xl bg-white/[0.02] px-4 py-3 ring-1 ring-white/[0.06]">
                    <div>
                      <div className="text-[14px] font-medium">{ch.name}</div>
                      <div className="text-[12px] text-dim">{ch.note}</div>
                    </div>
                    <span className="font-mono text-[12px] text-amber">{ch.multiplier}X</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between rounded-xl bg-amber/[0.06] px-4 py-3 text-[13px] ring-1 ring-amber/25">
                <span className="text-mute">On a ₹10,000 voucher</span>
                <span className="font-semibold text-amber">
                  {best.pctTravel.toFixed(1)}% via {best.channel.name}
                </span>
              </div>
            </Card>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {adding && (
          <motion.div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAdding(false)}>
            <motion.div role="dialog" aria-modal aria-label="Add card" onClick={(e) => e.stopPropagation()} initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} className="hairline w-full max-w-[440px] rounded-[28px] bg-ink-2 p-6">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-xl font-semibold">Add a card</h3>
                <button onClick={() => setAdding(false)} className="grid size-8 place-items-center rounded-full text-mute hover:bg-white/5" aria-label="Close">
                  <X className="size-4" />
                </button>
              </div>
              <p className="mt-1 text-[13px] text-mute">Pick issuer and variant. That's all we need.</p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                {CATALOG.map((c) => (
                  <button key={c.name} onClick={() => add(c)} className={cx("group relative aspect-[1.586] overflow-hidden rounded-xl bg-gradient-to-br p-3 text-left ring-1 ring-white/10 transition hover:ring-amber/60", c.gradient)}>
                    <div className="font-mono text-[9px] uppercase tracking-widest text-white/60">{c.issuer}</div>
                    <div className="absolute bottom-3 left-3 text-[12.5px] font-medium">{c.name}</div>
                    <span className="absolute top-2.5 right-2.5 grid size-5 place-items-center rounded-full bg-white/10 opacity-0 transition group-hover:opacity-100">
                      <Check className="size-3" />
                    </span>
                  </button>
                ))}
              </div>
              <Button variant="outline" className="mt-5 w-full" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BigCard({ c }: { c: CardT }) {
  return (
    <div className={cx("relative aspect-[1.586] overflow-hidden rounded-[22px] bg-gradient-to-br p-6 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.9)] ring-1 ring-white/15", c.gradient)}>
      <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_30%,rgba(255,255,255,0.12)_45%,transparent_60%)]" />
      <div className="absolute -top-20 -right-16 size-64 rounded-full bg-white/[0.06] blur-2xl" />
      <div className="relative flex justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-white/60">{c.issuer}</span>
        <span className="font-display text-sm font-semibold italic text-white/70">VISA</span>
      </div>
      <div className="relative mt-8 h-9 w-12 rounded-md bg-gradient-to-br from-[#e8d18a] via-[#b89646] to-[#806426] ring-1 ring-black/20">
        <div className="absolute inset-1.5 rounded-sm border border-black/20" />
      </div>
      <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between">
        <div>
          <div className="font-display text-2xl font-semibold tracking-tight">{c.name}</div>
          <div className="mt-1 font-mono text-[11px] tracking-[0.2em] text-white/40">•••• •••• •••• ····</div>
        </div>
        <span className="rounded-full bg-black/30 px-2.5 py-1 font-mono text-[10px] text-white/60 backdrop-blur">no number stored</span>
      </div>
    </div>
  );
}
