import { useEffect, useRef } from "react";
import { ledLayout } from "./led";

type Dot = { x: number; y: number; tx: number; ty: number; vx: number; vy: number; a: number; hot: number; wake: number; col: number };

type Props = {
  /** One string, or several to morph between. "\n" starts a new line. */
  text: string | string[];
  /** Dot colour. */
  color?: string;
  /** Colour dots turn when the pointer passes: the "positive" trail. */
  hot?: string;
  /** Largest dot pitch in px. The board shrinks to fit its container. */
  maxCell?: number;
  /** Below this pitch a single line is re-broken at spaces so it stays legible on phones. */
  minCell?: number;
  /** ms between texts when `text` is an array. */
  interval?: number;
  /** Also draw the unlit dots faintly, like a real panel. */
  panel?: string;
  className?: string;
};

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The LED board: text set in dots that fly in, breathe with a slow sweep, scatter from the pointer and turn
 * "positive" green where touched. With several texts the same dots regroup into the next one.
 */
export function LedBoard({ text, color = "#0000ff", hot = "#00c26e", maxCell = 16, minCell = 7, interval = 2600, panel, className }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const texts = Array.isArray(text) ? text : [text];
  const key = texts.join("|");

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const base = rgb(color);
    const warm = rgb(hot);

    let dots: Dot[] = [];
    let cell = maxCell;
    let W = 0;
    let H = 0;
    let cols = 0;
    let rows = 0;
    let idx = 0;
    let raf = 0;
    let visible = true;
    let born = performance.now();
    const pointer = { x: -9999, y: -9999, on: false };

    const build = (animateFrom: "scatter" | "morph") => {
      W = wrap.clientWidth;
      if (!W) return;
      let lines = texts[idx % texts.length].split("\n");
      let lay = ledLayout(lines);
      cell = Math.min(maxCell, W / lay.cols);
      if (cell < minCell && lines.length === 1 && lines[0].includes(" ")) {
        lines = lines[0].split(" ");
        lay = ledLayout(lines);
        cell = Math.min(maxCell, W / lay.cols);
      }
      cols = lay.cols;
      rows = lay.rows;
      H = Math.ceil(rows * cell);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const ox = (W - cols * cell) / 2;
      const old = dots;
      const now = performance.now();
      dots = lay.cells.map((c, i) => {
        const tx = ox + c.col * cell + cell / 2;
        const ty = c.row * cell + cell / 2;
        if (still) return { x: tx, y: ty, tx, ty, vx: 0, vy: 0, a: 1, hot: 0, wake: 0, col: c.col };
        if (animateFrom === "morph" && old.length) {
          const o = old[i % old.length];
          return { x: o.x, y: o.y, tx, ty, vx: (Math.random() - 0.5) * 14, vy: (Math.random() - 0.5) * 14, a: o.a, hot: o.hot, wake: now + Math.random() * 180, col: c.col };
        }
        return { x: tx + (Math.random() - 0.5) * W * 0.5, y: ty + (Math.random() - 0.5) * 260, tx, ty, vx: 0, vy: 0, a: 0, hot: 0, wake: now + c.col * 9 + Math.random() * 160, col: c.col };
      });
      if (animateFrom === "scatter") born = now;
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      const size = cell * 0.8;
      const ox = (W - cols * cell) / 2;
      if (panel) {
        ctx.fillStyle = panel;
        const s = cell * 0.22;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) ctx.fillRect(ox + c * cell + cell / 2 - s / 2, r * cell + cell / 2 - s / 2, s, s);
      }
      // A soft sweep crosses the board every few seconds.
      const sweep = still ? -1 : (((t - born) / 5200) % 1) * (cols + 24) - 12;
      const R = Math.max(70, cell * 7);
      for (const d of dots) {
        if (!still && t >= d.wake) {
          let fx = (d.tx - d.x) * 0.085;
          let fy = (d.ty - d.y) * 0.085;
          if (pointer.on) {
            const dx = d.x - pointer.x;
            const dy = d.y - pointer.y;
            const dist = Math.hypot(dx, dy);
            if (dist < R) {
              const p = 1 - dist / R;
              fx += (dx / (dist || 1)) * p * 5.5;
              fy += (dy / (dist || 1)) * p * 5.5;
              d.hot = Math.max(d.hot, p);
            }
          }
          d.vx = (d.vx + fx) * 0.8;
          d.vy = (d.vy + fy) * 0.8;
          d.x += d.vx;
          d.y += d.vy;
          d.a += (1 - d.a) * 0.12;
          d.hot *= 0.965;
        }
        const k = Math.max(0, 1 - Math.abs(d.col - sweep) / 4);
        const sz = size * (1 + k * 0.12 + d.hot * 0.25);
        const m = Math.min(1, d.hot * 1.4);
        ctx.globalAlpha = d.a;
        ctx.fillStyle = m > 0.02 ? `rgb(${Math.round(base[0] + (warm[0] - base[0]) * m)},${Math.round(base[1] + (warm[1] - base[1]) * m)},${Math.round(base[2] + (warm[2] - base[2]) * m)})` : color;
        ctx.fillRect(d.x - sz / 2, d.y - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1;
    };

    const loop = (t: number) => {
      draw(t);
      if (visible && !still) raf = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };

    build("scatter");
    start();

    const ro = new ResizeObserver(() => {
      if (wrap.clientWidth !== W) {
        build("morph");
        if (still) draw(performance.now());
      }
    });
    ro.observe(wrap);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) start();
    });
    io.observe(wrap);
    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.on = pointer.x > -120 && pointer.x < r.width + 120 && pointer.y > -120 && pointer.y < r.height + 120;
    };
    const leave = () => (pointer.on = false);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerleave", leave);
    // Only regroup while on screen: a rebuild clears the canvas, and the draw loop is paused off screen.
    const timer =
      texts.length > 1 && !still
        ? window.setInterval(() => {
            if (!visible) return;
            idx++;
            build("morph");
          }, interval)
        : 0;
    // Fonts don't matter here (we draw squares), but layout can settle a frame late.
    const settle = window.setTimeout(() => wrap.clientWidth !== W && build("morph"), 60);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerleave", leave);
      if (timer) window.clearInterval(timer);
      window.clearTimeout(settle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, color, hot, maxCell, minCell, interval, panel]);

  return (
    <div ref={wrapRef} className={className} aria-hidden>
      <canvas ref={canvasRef} className="block w-full" />
    </div>
  );
}
