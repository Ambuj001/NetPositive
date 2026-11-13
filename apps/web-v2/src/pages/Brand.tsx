import { Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import { LedBoard } from "../brand/LedBoard";
import { LED_CHARS } from "../brand/led";
import { PlusField } from "../brand/PlusField";
import { PixelIcon, type PixelName } from "../components/PixelIcon";
import { Button, Mark, PageHead, Sticker, cx } from "../components/ui";

const wrap = "mx-auto w-full max-w-[1200px] px-5 md:px-8";

const COLORS: { name: string; hex: string; use: string; dark?: boolean }[] = [
  { name: "Blue", hex: "#0000FF", use: "Brand, actions, links, LEDs", dark: true },
  { name: "Ink", hex: "#0A0B0D", use: "Text, dark buttons", dark: true },
  { name: "Positive", hex: "#00C26E", use: "Gains, live signals, the corner pixel", dark: true },
  { name: "Paper", hex: "#FFFFFF", use: "Background" },
  { name: "Mist", hex: "#F7F7F8", use: "Section bands, wells" },
  { name: "Slate", hex: "#6A6C73", use: "Secondary text", dark: true },
];

const ICONS: PixelName[] = ["lock", "card", "wallet", "shield", "clock", "human", "sealed", "plus", "scale", "code", "bolt", "bag", "chart"];

const FILES = [
  ["Mark", "/brand/mark.svg"],
  ["Mark, white", "/brand/mark-white.svg"],
  ["Wordmark", "/brand/wordmark.svg"],
  ["Wordmark, white", "/brand/wordmark-white.svg"],
  ["App icon", "/brand/app-icon.svg"],
];

export default function Brand() {
  const [text, setText] = useState("NET POSITIVE");
  const [copied, setCopied] = useState("");
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(v);
      setTimeout(() => setCopied(""), 1400);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className="pt-12 pb-10 md:pt-16">
      <div className={wrap}>
        <PageHead eyebrow="Brand kit" title="The NetPositive kit" sub="One blue, one pixel grid, one green pixel that means things went your way. Everything here is drawn for NetPositive and ships in the repo." />

        {/* Logo */}
        <Block title="Logo" note="A 3×3 pixel grid. Five pixels make the plus. The corner pixel is the positive one: it stays green on every background.">
          <div className="grid gap-4 md:grid-cols-3">
            <Tile className="bg-surface">
              <span className="np-logo flex items-center gap-3">
                <Mark className="size-12" animate />
                <span className="text-[30px] font-semibold tracking-[-0.04em]">NetPositive</span>
              </span>
            </Tile>
            <Tile className="bg-brand">
              <span className="np-logo flex items-center gap-3">
                <Mark className="size-12" tone="white" animate />
                <span className="text-[30px] font-semibold tracking-[-0.04em] text-white">NetPositive</span>
              </span>
            </Tile>
            <Tile className="bg-fg">
              <span className="np-logo flex items-center gap-3">
                <Mark className="size-12" tone="white" animate />
                <span className="text-[30px] font-semibold tracking-[-0.04em] text-white">NetPositive</span>
              </span>
            </Tile>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {FILES.map(([label, href]) => (
              <a key={href} href={href} download className="inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[13.5px] ring-1 ring-line-2 transition hover:bg-sunken">
                <Download className="size-3.5" /> {label}
              </a>
            ))}
          </div>
        </Block>

        {/* Colour */}
        <Block title="Colour" note="Blue leads. Green is never decoration: it only marks a gain or a live signal.">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            {COLORS.map((c) => (
              <button key={c.hex} onClick={() => copy(c.hex)} className="group overflow-hidden rounded-2xl text-left ring-1 ring-line transition hover:ring-line-2">
                <span className={cx("flex h-24 items-end justify-end p-3", c.dark ? "text-white" : "text-fg")} style={{ background: c.hex }}>
                  {copied === c.hex ? <Check className="size-4" /> : <Copy className="size-4 opacity-0 transition group-hover:opacity-80" />}
                </span>
                <span className="block p-3">
                  <span className="block text-[14px] font-medium">{c.name}</span>
                  <span className="block font-mono text-[12px] text-mute">{c.hex}</span>
                  <span className="mt-1 block text-[12px] leading-snug text-dim">{c.use}</span>
                </span>
              </button>
            ))}
          </div>
        </Block>

        {/* LED */}
        <Block title="LED type" note="Our display face is a 5×7 dot alphabet drawn on a live board. Dots fly in, a sweep crosses every few seconds, and they scatter and turn green where the pointer passes. Type to try it.">
          <div className="rounded-2xl border border-line p-6 md:p-10">
            <div className="flex min-h-[120px] items-center justify-center">
              <LedBoard text={text || " "} maxCell={12} className="w-full" />
            </div>
            <input
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 18))}
              className="mt-6 h-11 w-full rounded-full bg-sunken px-5 text-center font-mono text-[14px] tracking-[0.12em] uppercase outline-none ring-1 ring-line focus:ring-brand"
              aria-label="Text for the LED board"
              spellCheck={false}
            />
            <p className="mt-3 text-center font-mono text-[12px] tracking-[0.2em] text-dim">{LED_CHARS.join(" ")}</p>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="relative flex min-h-[220px] items-center justify-center overflow-hidden rounded-2xl bg-brand p-8">
              <LedBoard text={["₹", "$", "+"]} color="#ffffff" hot="#00e07f" maxCell={22} interval={1800} className="w-full" />
              <span className="absolute bottom-4 left-5 text-[12.5px] text-white/70">Morph: rupees in, dollars out, both positive</span>
            </div>
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-5 rounded-2xl bg-sunken p-8">
              <Sticker tilt={-2.5} className="text-[44px] leading-[1.1] tracking-[-0.04em]">
                KEEP REWARDS
              </Sticker>
              <span className="text-[12.5px] text-mute">Sticker: one per page, tilted 2.5°, always under LED type</span>
            </div>
          </div>
        </Block>

        {/* Type */}
        <Block title="Type" note="Geist for reading, Geist Mono for numbers, addresses and code.">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-line p-6">
              <div className="text-[44px] font-semibold leading-none tracking-[-0.045em]">Spend crypto.</div>
              <p className="mt-4 text-[16px] leading-relaxed text-mute">Headings are semibold with tight tracking. Body copy is regular at 16–18px in Slate, never pure black.</p>
            </div>
            <div className="rounded-2xl border border-line p-6 font-mono">
              <div className="tabular text-[44px] leading-none tracking-[-0.04em]">₹103.15</div>
              <p className="mt-4 text-[14px] leading-relaxed text-mute">0x8330…0c27 · 49.80 USDC · tabular figures everywhere a number can change.</p>
            </div>
          </div>
        </Block>

        {/* Icons */}
        <Block title="Pixel icons" note="7×7 glyphs in a ticked frame with the green corner pixel. They light up dot by dot; hover to replay.">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-7">
            {ICONS.map((n) => (
              <div key={n} className="flex flex-col items-center gap-3 rounded-2xl border border-line py-6">
                <PixelIcon name={n} size={52} />
                <span className="font-mono text-[11.5px] text-mute">{n}</span>
              </div>
            ))}
          </div>
        </Block>

        {/* Pattern */}
        <Block title="Plus field" note="The background pattern. Each plus turns a quarter and lights up under the pointer, and a ripple runs through on its own.">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="relative h-[240px] overflow-hidden rounded-2xl border border-line">
              <PlusField fade={false} />
            </div>
            <div className="relative h-[240px] overflow-hidden rounded-2xl bg-brand">
              <PlusField color="#ffffff" idle="rgba(255,255,255,0.22)" fade={false} />
            </div>
          </div>
        </Block>

        <div className="mt-16 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-sunken p-6">
          <p className="max-w-xl text-[14.5px] leading-relaxed text-mute">
            Source: <span className="font-mono text-fg">apps/web-v2/src/brand</span> (LED alphabet, LED board, plus field), <span className="font-mono text-fg">components/PixelIcon.tsx</span>, tokens in <span className="font-mono text-fg">src/index.css</span>, SVGs in <span className="font-mono text-fg">public/brand</span>.
          </p>
          <Button to="/">Back to the site</Button>
        </div>
      </div>
    </div>
  );
}

function Block({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="mt-16">
      <h2 className="text-[24px] font-semibold tracking-[-0.03em]">{title}</h2>
      <p className="mt-1.5 mb-6 max-w-2xl text-[15px] leading-relaxed text-mute">{note}</p>
      {children}
    </section>
  );
}

function Tile({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cx("grid h-40 place-items-center rounded-2xl ring-1 ring-line", className)}>{children}</div>;
}
