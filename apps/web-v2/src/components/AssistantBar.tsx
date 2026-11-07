import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ArrowUpRight, LoaderCircle, MessageCircle, Sparkles, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ChatbotError, chatbot, userIdFor } from "../lib/chatbot";
import { useApp } from "../lib/store";
import { cx } from "./ui";

/** A quick action: either run `on`, or send `ask` through the assistant. */
export type Chip = { label: string; on?: () => void; ask?: string };

/**
 * Compact assistant input under the order book. `intercept` lets the page handle a message
 * locally (e.g. "buy 10000"); otherwise it goes to the NetPositive AI chatbot.
 */
export function AssistantBar({
  role,
  placeholder,
  chips,
  intercept,
  tone = "mint",
}: {
  role: "buyer" | "seller";
  placeholder: string;
  chips: Chip[];
  intercept?: (text: string) => ReactNode | null | Promise<ReactNode | null>;
  tone?: "mint" | "amber";
}) {
  const { fullAddress } = useApp();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<{ q: string; a: ReactNode } | null>(null);

  const send = async (q: string) => {
    const msg = q.trim();
    if (!msg || busy) return;
    setText("");
    setBusy(true);
    try {
      const local = await intercept?.(msg);
      if (local) return setReply({ q: msg, a: local });
      const r = await chatbot.chat(userIdFor(fullAddress), role, msg);
      setReply({ q: msg, a: r.reply });
    } catch (e) {
      const a =
        e instanceof ChatbotError && e.kind === "offline"
          ? "The AI assistant isn't running. Start it with: cd chatbot && python3 server.py"
          : e instanceof ChatbotError && e.kind === "no_ai_key"
            ? "AI answers are off: the assistant server has no OpenRouter key."
            : e instanceof Error
              ? e.message
              : "Something went wrong.";
      setReply({ q: msg, a });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <AnimatePresence>
        {reply && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="hairline relative mb-2 rounded-2xl bg-ink-2/90 p-4 backdrop-blur-xl"
            role="status"
          >
            <button onClick={() => setReply(null)} className="absolute top-3 right-3 grid size-7 place-items-center rounded-full text-mute hover:bg-white/5 hover:text-fg" aria-label="Close answer">
              <X className="size-3.5" />
            </button>
            <div className="pr-8 text-[12px] text-dim">{reply.q}</div>
            <div className="mt-1.5 flex gap-2.5 text-[14px] leading-relaxed whitespace-pre-wrap text-fg/90">
              <Sparkles className={cx("mt-1 size-3.5 shrink-0", tone === "mint" ? "text-mint" : "text-amber")} />
              <div className="min-w-0">{reply.a}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
        className="hairline flex items-center gap-3 rounded-2xl bg-ink-2/80 p-2 pl-4 backdrop-blur-xl transition focus-within:shadow-[0_0_0_1px_rgba(61,220,151,0.35)]"
      >
        <MessageCircle className={cx("size-4 shrink-0", tone === "mint" ? "text-mint" : "text-amber")} />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          maxLength={500}
          aria-label="Ask the NetPositive assistant"
          className="h-10 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-dim"
        />
        <button type="submit" disabled={!text.trim() || busy} className="grid size-10 place-items-center rounded-xl bg-white/[0.05] text-fg ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-40" aria-label="Send">
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
        </button>
      </form>

      <div className="scrollbar-none mt-3 flex gap-2 overflow-x-auto">
        {chips.map((c) => (
          <button key={c.label} onClick={() => (c.ask ? send(c.ask) : c.on?.())} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white/[0.03] px-3 py-1.5 text-[12px] text-mute ring-1 ring-white/[0.07] transition hover:text-fg hover:ring-white/20">
            {c.label}
            <ArrowUpRight className="size-3" />
          </button>
        ))}
      </div>
    </div>
  );
}
