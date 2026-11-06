import { Check, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { CATALOG, isSaved, searchCatalog } from "../lib/cardCatalog";
import type { Card } from "../lib/engine";
import { Button, cx } from "./ui";

/**
 * Search the list of cards, tick the ones you have, add them. Each added card is saved to My cards (and so to the account).
 * Cards already saved are shown as added and can't be picked twice.
 */
export function CardPicker({
  saved,
  onAdd,
  secondary,
  autoFocus,
  listHeight = "max-h-[300px]",
}: {
  saved: Card[];
  onAdd: (cards: Card[]) => void;
  /** Shown beside the Add button, e.g. "Not now". */
  secondary?: ReactNode;
  autoFocus?: boolean;
  listHeight?: string;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const savedIds = useMemo(() => saved.map((c) => c.id), [saved]);
  const results = useMemo(() => searchCatalog(query), [query]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const add = () => {
    const chosen = CATALOG.filter((c) => picked.includes(c.id) && !isSaved(c.id, savedIds)).map((c) => c.profile);
    if (!chosen.length) return;
    setPicked([]);
    onAdd(chosen);
  };

  return (
    <div>
      <label className="flex h-11 items-center gap-2.5 rounded-2xl bg-white/[0.04] px-3.5 ring-1 ring-white/10 transition focus-within:ring-amber/45">
        <Search className="size-4 text-dim" />
        <input
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your card, e.g. Infinia, HDFC, Amazon Pay"
          aria-label="Search cards"
          maxLength={60}
          className="w-full min-w-0 bg-transparent text-[14px] outline-none placeholder:text-dim"
        />
      </label>

      <div className={cx("scrollbar-none mt-3 space-y-1.5 overflow-y-auto pr-0.5", listHeight)} role="group" aria-label="Cards">
        {results.length === 0 && <p className="px-1 py-6 text-center text-[13px] text-mute">No card matches “{query.trim()}”. Try the bank or a shorter name.</p>}
        {results.map((c) => {
          const already = isSaved(c.id, savedIds);
          const on = picked.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              disabled={already}
              aria-pressed={on}
              onClick={() => toggle(c.id)}
              className={cx(
                "flex w-full items-center gap-3 rounded-2xl p-3 text-left ring-1 transition",
                already ? "cursor-default bg-white/[0.015] opacity-55 ring-white/[0.05]" : on ? "bg-amber/[0.07] ring-amber/50" : "bg-white/[0.025] ring-white/[0.07] hover:bg-white/[0.05] hover:ring-white/15",
              )}
            >
              <span className={cx("grid size-5 shrink-0 place-items-center rounded-md ring-1", on || already ? "bg-amber text-ink ring-amber" : "ring-white/25")}>{(on || already) && <Check className="size-3.5" strokeWidth={3} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{c.title}</span>
                <span className={cx("block truncate text-[11.5px]", c.verified ? "text-mint" : "text-dim")}>{already ? "Already in My cards" : c.profile.last}</span>
              </span>
              <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] tracking-wide text-mute">{c.issuer}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col-reverse items-stretch gap-2.5 sm:flex-row sm:items-center sm:justify-end">
        {secondary}
        <Button variant="amber" size="md" disabled={picked.length === 0} onClick={add} className="sm:min-w-[150px]">
          {picked.length === 0 ? "Pick a card to add" : `Add ${picked.length} card${picked.length > 1 ? "s" : ""}`}
        </Button>
      </div>
    </div>
  );
}
