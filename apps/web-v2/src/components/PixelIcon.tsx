import { useState } from "react";
import { cx } from "./ui";

/** 7×7 LED bitmaps. "#" is a lit dot. Drawn for NetPositive; read top to bottom. */
const BITMAPS = {
  lock: ["..###..", ".#...#.", ".#...#.", "#######", "###.###", "###.###", "#######"],
  card: ["#######", "#.....#", "#######", "#######", "#.....#", "#.##..#", "#######"],
  wallet: [".######", "#......", "#######", "#....##", "#...#.#", "#....##", "#######"],
  shield: [".#####.", "##...##", "##.#.##", "##...##", ".##.##.", "..###..", "...#..."],
  clock: ["..###..", ".#.#.#.", "#..#..#", "#..##.#", "#.....#", ".#...#.", "..###.."],
  human: ["..###..", "..###..", "...#...", ".#####.", "#.###.#", "..#.#..", "..#.#.."],
  sealed: ["#######", "##...##", "#.#.#.#", "#..#..#", "#.....#", "#.....#", "#######"],
  plus: ["...#...", "...#...", "...#...", "#######", "...#...", "...#...", "...#..."],
  scale: ["...#...", ".#####.", "##.#.##", "...#...", "...#...", "...#...", ".#####."],
  code: [".##.##.", ".#...#.", ".#...#.", "#.....#", ".#...#.", ".#...#.", ".##.##."],
  bolt: ["....##.", "...##..", "..##...", ".#####.", "...##..", "..##...", ".##...."],
  bag: [".#...#.", ".#...#.", "#######", "#.....#", "#.....#", "#.....#", "#######"],
  chart: ["......#", ".....##", "#...#.#", "##.#..#", "#.#...#", "#.....#", "#######"],
} as const;

export type PixelName = keyof typeof BITMAPS;

/** A 7×7 pixel glyph in a ticked frame. The pixels light up one by one, and again on hover. */
export function PixelIcon({ name, className, size = 56, tone = "blue" }: { name: PixelName; className?: string; size?: number; tone?: "blue" | "white" | "fg" | "mint" }) {
  const rows = BITMAPS[name];
  const [run, setRun] = useState(0);
  const lit = tone === "white" ? "#ffffff" : tone === "fg" ? "#0a0b0d" : "#0000ff";
  const frame = tone === "white" ? "rgba(255,255,255,0.55)" : "#0a0b0d";
  return (
    <span className={cx("relative inline-grid shrink-0 place-items-center", className)} style={{ width: size, height: size }} aria-hidden onMouseEnter={() => setRun((n) => n + 1)}>
      <svg viewBox="0 0 56 56" className="absolute inset-0 size-full" fill="none" stroke={frame} strokeWidth="1.6">
        <path d="M2 11V2h9M45 2h9v9M54 45v9h-9M11 54H2v-9" />
      </svg>
      <svg viewBox="0 0 7 7" className="size-[54%]" key={run}>
        {rows.flatMap((row, r) =>
          row.split("").map((ch, c) =>
            ch === "#" ? <rect key={`${r}-${c}`} className="np-px" x={c + 0.1} y={r + 0.1} width={0.8} height={0.8} fill={lit} style={{ animationDelay: `${(r * 7 + c) * 9}ms` }} /> : null,
          ),
        )}
      </svg>
      <span className="absolute -top-[3px] -right-[3px] size-[7px] bg-pos" />
    </span>
  );
}
