import { useEffect, useRef } from "react";

/**
 * The plus field: a quiet grid of "+" marks. They spin and light up under the pointer, and a ripple runs through
 * them every few seconds. Sits behind hero and call-to-action areas; never intercepts clicks.
 */
export function PlusField({ className, color = "#0000ff", idle = "rgba(10,11,13,0.12)", gap = 30, fade = true }: { className?: string; color?: string; idle?: string; gap?: number; fade?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0;
    let H = 0;
    let raf = 0;
    let visible = true;
    const p = { x: -9999, y: -9999 };
    const t0 = performance.now();

    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;
      const ripple = still ? -999 : (((t - t0) / 4200) % 1) * Math.hypot(cx, cy) * 1.25;
      const cols = Math.ceil(W / gap) + 1;
      const rows = Math.ceil(H / gap) + 1;
      const ox = (W - (cols - 1) * gap) / 2;
      const oy = (H - (rows - 1) * gap) / 2;
      ctx.lineCap = "square";
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = ox + c * gap;
          const y = oy + r * gap;
          const near = Math.max(0, 1 - Math.hypot(x - p.x, y - p.y) / 150);
          const wave = Math.max(0, 1 - Math.abs(Math.hypot(x - cx, y - cy) - ripple) / 46) * 0.55;
          const k = Math.max(near, wave);
          const arm = 2.6 + k * 3.4;
          const rot = k * (Math.PI / 2);
          // Edges fall away so the field never fights the content.
          const edge = fade ? Math.min(1, Math.min(x, W - x) / 160) * Math.min(1, Math.min(y, H - y) / 110) * Math.min(1, 0.12 + Math.pow(Math.hypot((x - cx) / (W * 0.4), (y - cy) / (H * 0.55)), 2)) : 1;
          ctx.globalAlpha = edge * (k > 0.03 ? 0.35 + k * 0.65 : 1);
          ctx.strokeStyle = k > 0.03 ? color : idle;
          ctx.lineWidth = 1 + k * 0.9;
          const cs = Math.cos(rot) * arm;
          const sn = Math.sin(rot) * arm;
          ctx.beginPath();
          ctx.moveTo(x - cs, y - sn);
          ctx.lineTo(x + cs, y + sn);
          ctx.moveTo(x + sn, y - cs);
          ctx.lineTo(x - sn, y + cs);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    };
    const loop = (t: number) => {
      draw(t);
      if (visible && !still) raf = requestAnimationFrame(loop);
    };
    size();
    raf = requestAnimationFrame(loop);
    const ro = new ResizeObserver(() => {
      size();
      if (still) draw(0);
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(loop);
      }
    });
    io.observe(canvas);
    const move = (e: PointerEvent) => {
      const b = canvas.getBoundingClientRect();
      p.x = e.clientX - b.left;
      p.y = e.clientY - b.top;
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", move);
    };
  }, [color, idle, gap, fade]);
  return <canvas ref={ref} aria-hidden className={`pointer-events-none absolute inset-0 size-full ${className ?? ""}`} />;
}
