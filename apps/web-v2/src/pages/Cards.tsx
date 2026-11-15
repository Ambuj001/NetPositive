import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Check, CreditCard, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CardPicker } from "../components/CardPicker";
import { AppHead, AppPage, Button, cx } from "../components/ui";
import { inr, routesFor, type Card } from "../lib/engine";
import { useApp } from "../lib/store";

/** Dark card faces, cycled for saved cards (matches the example card colours). */
const FACES = [
  "linear-gradient(130deg,#0f3a2c 0%,#1d6048 55%,#0b241c 100%)",
  "linear-gradient(130deg,#3a1424 0%,#6b2b45 55%,#220c16 100%)",
  "linear-gradient(130deg,#10263f 0%,#2a5577 55%,#0a1828 100%)",
  "linear-gradient(130deg,#2a1a40 0%,#4c3175 55%,#170e24 100%)",
];

const BLANK = { issuer: "", name: "", points: "1", unit: "100", cash: "1", travel: "1" };

export default function Cards() {
  const { cards, cardsAreExamples, setCards, toast, fullAddress, token, signIn, signingIn } = useApp();
  const [selected, setSelected] = useState(cards[0]?.id ?? "");
  const [value, setValue] = useState<"cash" | "travel">("cash");
  // /cards?add=1 (from the "add your cards" pop-up) opens the add dialog straight away.
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(params.get("add") === "1");
  useEffect(() => {
    if (params.get("add") === "1") {
      setAdding(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);
  const card = cards.find((c) => c.id === selected) ?? cards[0];
  const routes = card ? routesFor(10000, [card]).sort((a, b) => (value === "cash" ? b.statementInr - a.statementInr : b.travelInr - a.travelInr)) : [];

  const add = (c: Card) => {
    setCards(cards.some((x) => x.id === c.id) ? cards : [...cards, c]);
    setSelected(c.id);
    setAdding(false);
    toast({ title: `${c.issuer} ${c.name} saved`, body: "Issuer, variant and reward rates only. No card number.", tone: "amber" });
  };
  const addMany = (list: Card[]) => {
    const fresh = list.filter((c) => !cards.some((x) => x.id === c.id));
    if (!fresh.length) return;
    setCards([...cards, ...fresh]);
    setSelected(fresh[0].id);
    setAdding(false);
    toast({ title: `${fresh.length} card${fresh.length > 1 ? "s" : ""} saved`, body: "Saved to your account. Issuer, variant and reward rates only. No card number.", tone: "amber" });
  };
  const remove = () => {
    if (!card) return;
    const next = cards.filter((c) => c.id !== card.id);
    setCards(next);
    setSelected(next[0]?.id ?? "");
    toast({ title: "Card removed" });
  };

  return (
    <AppPage>
        <AppHead
          title="My cards"
          sub="Your cards' reward rates decide which voucher orders are worth the most to you. Only reward profiles are saved, never card numbers."
          right={
            <Button size="sm" variant="amber" onClick={() => setAdding(true)} icon={<Plus className="size-3.5" />}>
              Add card
            </Button>
          }
        />

        {fullAddress && !token && (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-amber/[0.07] p-3.5 ring-1 ring-amber/30 sm:flex-row sm:items-center">
            <p className="flex-1 text-[13.5px] leading-relaxed text-fg/85">You're connected but not signed in. Sign in (one free signature) to load the cards saved on your account and to save new ones. Until then you see example cards.</p>
            <Button variant="amber" size="sm" onClick={() => void signIn()} disabled={signingIn}>
              {signingIn ? "Check your wallet…" : "Sign in"}
            </Button>
          </div>
        )}

        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          {/* card stack */}
          <section className="hairline rounded-[22px] bg-surface/70 p-5 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-semibold">{cardsAreExamples ? "Example cards" : "My cards"}</h2>
              <span className="text-[12px] text-dim">{cardsAreExamples ? "none saved yet" : `${cards.length} saved`}</span>
            </div>
            {cardsAreExamples && (
              <p className="mt-3 rounded-xl bg-amber/10 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-amber-ink" data-testid="example-cards-note">
                These are example cards, not yours. Their reward rates are illustrative. Add your own cards to see real routes; the examples go away as soon as you add or change one.
              </p>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {cards.map((c, i) => {
                const on = c.id === card?.id;
                return (
                  <motion.button
                    key={c.id}
                    onClick={() => setSelected(c.id)}
                    aria-pressed={on}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={{ y: -4 }}
                    transition={{ duration: 0.25 }}
                    className={cx(
                      "relative block aspect-[1.75] w-full overflow-hidden rounded-[16px] p-4 text-left shadow-[0_30px_70px_-30px_rgba(12,13,15,0.14)] ring-1 transition",
                      on ? "ring-2 ring-brand/70 ring-offset-4 ring-offset-ink-2" : "ring-fg/10 opacity-80 hover:opacity-100",
                    )}
                    style={{ background: FACES[i % FACES.length] }}
                  >
                    <span className="absolute inset-0 bg-[linear-gradient(115deg,transparent_30%,rgba(12,13,15,0.09)_45%,transparent_60%)]" />
                    <CreditCard className="absolute top-4 right-4 size-5 text-fg/45" />
                    <span className="absolute right-10 bottom-4 left-4">
                      <span className="block font-mono text-[11px] tracking-[0.25em] text-fg/55 uppercase">{c.issuer}</span>
                      <span className="mt-1 block truncate font-display text-[19px] font-semibold tracking-tight text-white">{c.name}</span>
                      <span className="mt-1 block text-[11.5px] text-fg/45">{c.last || "Reward profile"}</span>
                    </span>
                    {on && <Check className="absolute right-4 bottom-4 size-5 text-brand-ink" />}
                  </motion.button>
                );
              })}
              {!cards.length && (
                <div className="grid place-items-center rounded-2xl border border-dashed border-fg/15 py-8 text-center sm:col-span-2">
                  <CreditCard className="size-6 text-dim" />
                  <div className="mt-3 text-[15px] font-medium">Your portfolio starts here.</div>
                  <Button className="mt-4" size="sm" variant="outline" onClick={() => setAdding(true)} icon={<Plus className="size-3.5" />}>
                    Add your first card
                  </Button>
                </div>
              )}
            </div>
          </section>

          {/* details */}
          <AnimatePresence mode="wait">
            {card && (
              <motion.div key={card.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4 lg:sticky lg:top-24">
                <section className="hairline rounded-[22px] bg-surface/70 p-5 backdrop-blur-xl">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[16px] font-semibold">
                      {card.issuer} {card.name}
                    </h2>
                    <button onClick={remove} className="grid size-9 place-items-center rounded-full text-mute ring-1 ring-fg/10 transition hover:text-rose-ink hover:ring-rose/40" aria-label={`Remove ${card.issuer} ${card.name}`}>
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <div className="mt-4 flex items-baseline gap-3">
                    <span className="font-display text-[40px] leading-none font-semibold tracking-tight tabular">{card.pointsPer}</span>
                    <span className="text-[13px] text-mute">points per {inr(card.spendUnit)}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 border-t border-fg/[0.07] pt-3.5">
                    <div>
                      <div className="text-[12px] text-dim">Cash value</div>
                      <div className="mt-1 text-[16px] font-medium tabular">{inr(card.statementValue, 2)} / point</div>
                    </div>
                    <div>
                      <div className="text-[12px] text-dim">Travel value</div>
                      <div className="mt-1 text-[16px] font-medium tabular">{inr(card.travelValue, 2)} / point</div>
                    </div>
                  </div>
                </section>

                <section className="hairline rounded-[22px] bg-surface/70 p-5 backdrop-blur-xl">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[16px] font-semibold">On a ₹10,000 voucher</h2>
                    <div className="flex rounded-xl bg-fg/[0.03] p-1 ring-1 ring-fg/[0.07]" aria-label="Reward value">
                      {(["cash", "travel"] as const).map((v) => (
                        <button key={v} onClick={() => setValue(v)} aria-pressed={value === v} className={cx("h-7 rounded-lg px-3 text-[12px] capitalize transition", value === v ? "bg-fg/[0.08] text-fg" : "text-mute hover:text-fg")}>
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 divide-y divide-fg/[0.06] border-t border-fg/[0.06]">
                    {routes.map((r) => (
                      <div key={r.channel.id} className="flex items-center justify-between py-2.5">
                        <div>
                          <div className="text-[14px] font-medium">{r.channel.name}</div>
                          <div className="text-[11.5px] text-dim">
                            {r.points.toLocaleString("en-IN")} pts{r.discountInr ? ` + ${inr(r.discountInr)} off` : ""} · {r.txns} purchase{r.txns > 1 ? "s" : ""}
                          </div>
                        </div>
                        <span className="font-medium text-brand-ink tabular">{(value === "cash" ? r.pctStatement : r.pctTravel).toFixed(2)}%</span>
                      </div>
                    ))}
                  </div>
                  <Link to="/trade" className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-brand-ink hover:underline">
                    Compare in Trade <ArrowUpRight className="size-3.5" />
                  </Link>
                </section>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      <AddCard open={adding} onClose={() => setAdding(false)} saved={cards} onAdd={add} onAddMany={addMany} />
    </AppPage>
  );
}

function AddCard({ open, onClose, saved, onAdd, onAddMany }: { open: boolean; onClose: () => void; saved: Card[]; onAdd: (c: Card) => void; onAddMany: (c: Card[]) => void }) {
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState("");

  const submit = () => {
    const p = Number(form.points);
    const u = Number(form.unit);
    const cash = Number(form.cash);
    const travel = Number(form.travel);
    const ok =
      form.issuer.trim() &&
      form.name.trim() &&
      [p, u, cash, travel].every(Number.isFinite) &&
      p >= 0 &&
      p <= 100 &&
      u > 0 &&
      u <= 100000 &&
      cash >= 0 &&
      cash <= 100 &&
      travel >= 0 &&
      travel <= 100 &&
      // Reward can't be worth more than what was spent.
      p * Math.max(cash, travel) <= u;
    if (!ok) return setError("Check the values. Points × value per point can't be more than the spend.");
    setError("");
    setForm(BLANK);
    onAdd({
      id: `custom-${crypto.randomUUID()}`,
      issuer: form.issuer.trim().slice(0, 30),
      name: form.name.trim().slice(0, 40),
      last: "Custom",
      gradient: "",
      pointsPer: p,
      spendUnit: u,
      travelValue: travel,
      statementValue: cash,
      bonusCap: 0,
      bonusUsed: 0,
      channels: [{ id: "direct", name: "Direct", multiplier: 1, denomination: 10000, note: "Your reward assumptions" }],
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-fg/30 p-4 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal
            aria-label="Add a card"
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            className="hairline my-auto w-full max-w-[520px] rounded-[26px] bg-surface p-6"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl font-semibold tracking-tight">Add a card</h3>
              <button onClick={onClose} className="grid size-8 place-items-center rounded-full text-mute hover:bg-fg/5" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-1 text-[13px] text-mute">Search the list and tick your cards, or enter your own below. Issuer, variant and reward rates only. Never a card number or CVV.</p>

            <div className="mt-5">
              <CardPicker saved={saved} onAdd={onAddMany} listHeight="max-h-[260px]" />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className="mt-6 border-t border-fg/[0.07] pt-5"
            >
              <div className="text-[14px] font-medium">Or enter your own</div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {(
                  [
                    ["issuer", "Issuer", "text"],
                    ["name", "Card name", "text"],
                    ["points", "Base points", "number"],
                    ["unit", "Per spend (₹)", "number"],
                    ["cash", "Cash value / point (₹)", "number"],
                    ["travel", "Travel value / point (₹)", "number"],
                  ] as const
                ).map(([key, label, type]) => (
                  <label key={key} className="block">
                    <span className="mb-1 block text-[11.5px] text-mute">{label}</span>
                    <input
                      required
                      type={type}
                      step="any"
                      min={type === "number" ? 0 : undefined}
                      maxLength={40}
                      value={form[key]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      className="h-10 w-full rounded-xl bg-fg/[0.04] px-3 text-[13.5px] ring-1 ring-fg/10 outline-none focus:ring-amber/45"
                    />
                  </label>
                ))}
              </div>
              {error && (
                <p role="alert" className="mt-3 text-[12px] text-rose-ink">
                  {error}
                </p>
              )}
              <Button type="submit" variant="amber" className="mt-5 w-full">
                Save card
              </Button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
