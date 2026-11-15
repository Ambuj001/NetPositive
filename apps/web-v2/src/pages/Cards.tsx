import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Check, CreditCard, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CardPicker } from "../components/CardPicker";
import { AppHead, AppPage, Button, Callout, DUR, Dialog, EASE, EmptyState, Segmented, cx, enter } from "../components/ui";
import { inr, routesFor, type Card } from "../lib/engine";
import { useApp } from "../lib/store";

/** Card faces in the brand's two colours, ink and electric blue, cycled for saved cards. An LED dot field sits on top. */
const FACES = [
  "linear-gradient(135deg,#0c0d0f 0%,#1d1f25 100%)",
  "linear-gradient(135deg,#0000ff 0%,#0000b8 100%)",
  "linear-gradient(135deg,#16171c 0%,#0a0a40 100%)",
  "linear-gradient(135deg,#1a1aff 0%,#0c0d0f 120%)",
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
    toast({ title: `${c.issuer} ${c.name} saved`, body: "Issuer, variant and reward rates only. No card number.", tone: "mint" });
  };
  const addMany = (list: Card[]) => {
    const fresh = list.filter((c) => !cards.some((x) => x.id === c.id));
    if (!fresh.length) return;
    setCards([...cards, ...fresh]);
    setSelected(fresh[0].id);
    setAdding(false);
    toast({ title: `${fresh.length} card${fresh.length > 1 ? "s" : ""} saved`, body: "Saved to your account. Issuer, variant and reward rates only. No card number.", tone: "mint" });
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
            <Button size="sm" onClick={() => setAdding(true)} icon={<Plus className="size-3.5" />}>
              Add card
            </Button>
          }
        />

        {fullAddress && !token && (
          <Callout tone="amber" className="mt-4 items-center">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <p className="flex-1">You're connected but not signed in. Sign in (one free signature) to load the cards saved on your account and to save new ones. Until then you see example cards.</p>
              <Button variant="dark" size="sm" onClick={() => void signIn()} pending={signingIn}>
                {signingIn ? "Check your wallet…" : "Sign in"}
              </Button>
            </div>
          </Callout>
        )}

        <div className={cx("mt-5 grid items-start gap-5", card && "lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]")}>
          {/* card stack */}
          <section className="panel p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-semibold tracking-[-0.02em]">{cardsAreExamples ? "Example cards" : "My cards"}</h2>
              <span className="text-[12.5px] text-mute tabular">{cardsAreExamples ? "none saved yet" : `${cards.length} saved`}</span>
            </div>
            {cardsAreExamples && (
              <Callout tone="amber" className="mt-3" >
                <span data-testid="example-cards-note">These are example cards, not yours. Their reward rates are illustrative. Add your own cards to see real routes; the examples go away as soon as you add or change one.</span>
              </Callout>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {cards.map((c, i) => {
                const on = c.id === card?.id;
                return (
                  <motion.button
                    key={c.id}
                    onClick={() => setSelected(c.id)}
                    aria-pressed={on}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={{ y: -2 }}
                    transition={{ duration: DUR.base, ease: EASE }}
                    className={cx(
                      "relative block aspect-[1.75] w-full overflow-hidden rounded-2xl p-4 text-left shadow-[0_18px_40px_-24px_rgba(12,13,15,0.45)] transition-[box-shadow,opacity] duration-200",
                      on ? "ring-2 ring-brand ring-offset-2 ring-offset-surface" : "opacity-85 hover:opacity-100",
                    )}
                    style={{ background: FACES[i % FACES.length] }}
                  >
                    <span className="led-bg absolute inset-0 opacity-60" />
                    <CreditCard className="absolute top-4 right-4 size-5 text-white/50" />
                    <span className="absolute right-10 bottom-4 left-4">
                      <span className="block truncate font-mono text-[10.5px] tracking-[0.2em] text-white/60 uppercase">{c.issuer}</span>
                      <span className="mt-1 block truncate text-[18px] font-semibold tracking-[-0.02em] text-white">{c.name}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-white/55">{c.last || "Reward profile"}</span>
                    </span>
                    {on && (
                      <span className="absolute right-3.5 bottom-3.5 grid size-6 place-items-center rounded-full bg-white text-brand">
                        <Check className="size-3.5" strokeWidth={3} />
                      </span>
                    )}
                  </motion.button>
                );
              })}
              {!cards.length && (
                <EmptyState
                  className="border-dashed shadow-none sm:col-span-2"
                  icon={<CreditCard />}
                  title="Your portfolio starts here."
                  action={
                    <Button size="sm" variant="outline" onClick={() => setAdding(true)} icon={<Plus className="size-3.5" />}>
                      Add your first card
                    </Button>
                  }
                />
              )}
            </div>
          </section>

          {/* details */}
          <AnimatePresence mode="wait">
            {card && (
              <motion.div key={card.id} {...enter} className="space-y-4 lg:sticky lg:top-24">
                <section className="panel p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="min-w-0 truncate text-[17px] font-semibold tracking-[-0.02em]" title={`${card.issuer} ${card.name}`}>
                      {card.issuer} {card.name}
                    </h2>
                    <button onClick={remove} className="grid size-9 shrink-0 place-items-center rounded-full text-mute ring-1 ring-line-2 transition-colors hover:bg-rose/8 hover:text-rose-ink hover:ring-rose/40" aria-label={`Remove ${card.issuer} ${card.name}`} title="Remove card">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <div className="mt-4 flex items-baseline gap-3">
                    <span className="font-display text-[36px] leading-none font-semibold tracking-tight tabular">{card.pointsPer}</span>
                    <span className="text-[13px] text-mute">points per {inr(card.spendUnit)}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4">
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

                <section className="panel p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-[17px] font-semibold tracking-[-0.02em]">On a ₹10,000 voucher</h2>
                    <Segmented
                      id="reward-value"
                      label="Reward value"
                      value={value}
                      onChange={setValue}
                      options={[
                        { value: "cash", label: "Cash" },
                        { value: "travel", label: "Travel" },
                      ]}
                    />
                  </div>
                  <div className="mt-4 divide-y divide-line border-t border-line">
                    {routes.map((r) => (
                      <div key={r.channel.id} className="flex items-center justify-between gap-4 py-3">
                        <div>
                          <div className="text-[14px] font-medium">{r.channel.name}</div>
                          <div className="text-[12px] text-dim tabular">
                            {r.points.toLocaleString("en-IN")} pts{r.discountInr ? ` + ${inr(r.discountInr)} off` : ""} · {r.txns} purchase{r.txns > 1 ? "s" : ""}
                          </div>
                        </div>
                        <span className="font-medium text-brand-ink tabular">{(value === "cash" ? r.pctStatement : r.pctTravel).toFixed(2)}%</span>
                      </div>
                    ))}
                  </div>
                  <Link to="/trade" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-ink hover:underline">
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
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      icon={<CreditCard />}
      title="Add a card"
      description="Search the list and tick your cards, or enter your own below. Issuer, variant and reward rates only. Never a card number or CVV."
    >
      <CardPicker saved={saved} onAdd={onAddMany} listHeight="max-h-[min(260px,32dvh)]" />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="mt-6 border-t border-line pt-5"
      >
        <div className="text-[14px] font-medium">Or enter your own</div>
        <div className="mt-3 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
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
              <span className="mb-1.5 block text-[12.5px] text-mute">{label}</span>
              <input
                required
                type={type}
                step="any"
                min={type === "number" ? 0 : undefined}
                maxLength={40}
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                className={cx("field h-11 px-3.5", type === "number" && "tabular")}
              />
            </label>
          ))}
        </div>
        {error && (
          <Callout role="alert" tone="rose" className="mt-3">
            {error}
          </Callout>
        )}
        <Button type="submit" variant="dark" className="mt-5 w-full">
          Save card
        </Button>
      </form>
    </Dialog>
  );
}
