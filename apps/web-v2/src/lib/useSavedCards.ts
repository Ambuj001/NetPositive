import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { loadFromServer, pushChanges } from "./cardsSync";
import { CARDS, type Card } from "./engine";

/**
 * The person's saved card reward profiles (issuer, variant, rates; never card numbers).
 *
 * Signed in: the list lives in Firestore (users/{wallet}/cards/{id}) and follows them to any device. Changes show at once
 * and are written in the background (edits are grouped for a moment, so dragging a slider is one write, not hundreds).
 * Not signed in: kept in this browser per wallet, starting from the example cards.
 */

const LOCAL_KEY = (addr: string) => `netpositive:cards:${(addr || "guest").toLowerCase()}`;
const MIGRATED_KEY = (addr: string) => `netpositive:cards-migrated:${addr.toLowerCase()}`;
const DISMISSED_KEY = (addr: string) => `netpositive:cards-prompt-dismissed:${(addr || "guest").toLowerCase()}`;
const SAVE_DELAY_MS = 400;

const num = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
/** Accepts only well-formed card profiles from storage; anything else falls back to the examples. */
function isCard(c: unknown): c is Card {
  const x = c as Card;
  return (
    !!x &&
    typeof x.id === "string" &&
    typeof x.issuer === "string" &&
    typeof x.name === "string" &&
    num(x.pointsPer, 0, 100) &&
    num(x.spendUnit, 0.01, 100000) &&
    num(x.travelValue, 0, 100) &&
    num(x.statementValue, 0, 100) &&
    num(x.bonusCap, 0, 10_000_000) &&
    num(x.bonusUsed, 0, 10_000_000) &&
    Array.isArray(x.channels) &&
    x.channels.length > 0 &&
    x.channels.every((ch) => typeof ch?.id === "string" && typeof ch.name === "string" && num(ch.multiplier, 0, 100) && num(ch.denomination, 1, 10_000_000))
  );
}

/** Saved in this browser, or null if nothing was ever saved here. */
function readLocal(addr: string): Card[] | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY(addr));
    if (raw === null) return null;
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.every(isCard) ? v : null;
  } catch {
    return null;
  }
}
function writeLocal(addr: string, cards: Card[]) {
  try {
    localStorage.setItem(LOCAL_KEY(addr), JSON.stringify(cards));
  } catch {
    /* storage blocked: keep for this session only */
  }
}
const flag = (key: string) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};
const setFlag = (key: string) => {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* nothing to do */
  }
};

type Toast = (t: { title: string; body?: string; tone?: "mint" | "amber" | "iris" | "rose" }) => void;

export function useSavedCards({ address, token, toast }: { address: string; token: string | null; toast: Toast }) {
  const [cards, setCardsState] = useState<Card[]>(() => readLocal("") ?? CARDS);
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const cardsRef = useRef(cards);
  const synced = useRef<Card[]>([]); // what the server is known to hold
  const tokenRef = useRef(token);
  const loadedRef = useRef(false);
  const addressRef = useRef(address);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const toastRef = useRef(toast);
  tokenRef.current = token;
  loadedRef.current = loaded;
  addressRef.current = address;
  toastRef.current = toast;

  const flush = useCallback(async () => {
    const t = tokenRef.current;
    if (!t || !loadedRef.current) return;
    const target = cardsRef.current;
    const g = generation.current;
    const r = await pushChanges(api, t, synced.current, target);
    if (g !== generation.current) return;
    if (r.ok) {
      synced.current = target;
      return;
    }
    toastRef.current({ title: "Couldn't save your cards", body: r.error, tone: "rose" });
    // Show what is really saved instead of leaving the screen out of step with the server.
    if (r.server) {
      synced.current = r.server;
      cardsRef.current = r.server;
      setCardsState(r.server);
    }
  }, []);

  const writeNow = useCallback(() => {
    clearTimeout(timer.current);
    queue.current = queue.current.then(flush);
  }, [flush]);

  // Load this wallet's cards whenever the wallet or the sign-in changes.
  useEffect(() => {
    const g = ++generation.current;
    clearTimeout(timer.current);
    setLoaded(false);
    loadedRef.current = false;
    setDismissed(flag(DISMISSED_KEY(address)));
    const local = readLocal(address) ?? CARDS;
    cardsRef.current = local;
    setCardsState(local);
    if (!token || !address) return;

    (async () => {
      try {
        const res = await loadFromServer(api, token, readLocal(address) ?? [], flag(MIGRATED_KEY(address)));
        if (g !== generation.current) return;
        const list = res.cards;
        setFlag(MIGRATED_KEY(address));
        synced.current = list;
        cardsRef.current = list;
        setCardsState(list);
        setDismissed(res.promptDismissed || flag(DISMISSED_KEY(address)));
        loadedRef.current = true;
        setLoaded(true);
      } catch {
        /* the server is unreachable: keep the cards from this browser and don't show the pop-up */
      }
    })();
  }, [address, token]);

  // Don't lose a change if the tab is closed or hidden before the short delay ends.
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && writeNow();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      clearTimeout(timer.current);
    };
  }, [writeNow]);

  const setCards = useCallback(
    (next: Card[]) => {
      cardsRef.current = next;
      setCardsState(next);
      if (tokenRef.current && loadedRef.current) {
        clearTimeout(timer.current);
        timer.current = setTimeout(writeNow, SAVE_DELAY_MS);
      } else {
        writeLocal(addressRef.current, next);
      }
    },
    [writeNow],
  );

  const dismissPrompt = useCallback(() => {
    setDismissed(true);
    setFlag(DISMISSED_KEY(addressRef.current));
    const t = tokenRef.current;
    if (t) void api.cardsPromptDismiss(t).catch(() => undefined);
  }, []);

  return { cards, setCards, cardsLoaded: loaded, cardsPromptDismissed: dismissed, dismissCardsPrompt: dismissPrompt };
}
