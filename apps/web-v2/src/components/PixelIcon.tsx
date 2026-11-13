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

/** A pixel glyph inside a framed tile with corner ticks. */
export function PixelIcon({ name, className, size = 56, tone = "fg" }: { name: PixelName; className?: string; size?: number; tone?: "fg" | "mint" }) {
  const rows = BITMAPS[name];
  const lit = tone === "mint" ? "#00c866" : "#0c0d0f";
  return (
    <span className={cx("relative inline-grid shrink-0 place-items-center", className)} style={{ width: size, height: size }} aria-hidden>
      {/* corner ticks */}
      <svg viewBox="0 0 56 56" className="absolute inset-0 size-full" fill="none" stroke="#0c0d0f" strokeWidth="2">
        <path d="M2 12V2h10M44 2h10v10M54 44v10H44M12 54H2V44" />
      </svg>
      <svg viewBox="0 0 7 7" className="size-[56%]">
        {rows.flatMap((row, r) =>
          row.split("").map((ch, c) =>
            ch === "#" ? (
              <rect key={`${r}-${c}`} x={c + 0.12} y={r + 0.12} width={0.76} height={0.76} rx={0.18} fill={lit} />
            ) : (
              <rect key={`${r}-${c}`} x={c + 0.36} y={r + 0.36} width={0.28} height={0.28} rx={0.1} fill="#0c0d0f" opacity={0.12} />
            ),
          ),
        )}
      </svg>
      <span className="absolute -top-0.5 -right-0.5 size-2 rounded-[2px] bg-mint" />
    </span>
  );
}
