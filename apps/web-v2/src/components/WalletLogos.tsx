/**
 * Simple wallet marks for the picker. When a wallet extension is installed we
 * show the real icon it announces (EIP-6963) instead.
 */
import type { ReactNode } from "react";

const tile = (bg: string, child: ReactNode) => (
  <svg viewBox="0 0 36 36" className="size-full" aria-hidden>
    <rect width="36" height="36" rx="10" fill={bg} />
    {child}
  </svg>
);

const MARKS: Record<string, ReactNode> = {
  base: tile("#0000ff", <rect x="10" y="10" width="16" height="16" rx="2.5" fill="#fff" />),
  metamask: tile(
    "#ffffff",
    <g>
      <path d="M8 9l8 6-1.5-3.6L8 9z" fill="#e2761b" />
      <path d="M28 9l-8 6 1.5-3.6L28 9z" fill="#e4761b" />
      <path d="M9 10l2.2 9.5L9.8 25l6 1.6 1.2-4.4-4-3.3L9 10z" fill="#f6851b" />
      <path d="M27 10l-2.2 9.5 1.4 5.5-6 1.6-1.2-4.4 4-3.3L27 10z" fill="#f6851b" />
      <path d="M15.8 26.6l2.2-1.4 2.2 1.4-.4 1.9h-3.6l-.4-1.9z" fill="#c0ad9e" />
      <path d="M14 18.5l1.6 1.1-1.9.6.3-1.7zM22 18.5l-1.6 1.1 1.9.6-.3-1.7z" fill="#233447" />
    </g>,
  ),
  coinbase: tile(
    "#0052ff",
    <g>
      <circle cx="18" cy="18" r="10" fill="#fff" />
      <rect x="14.5" y="14.5" width="7" height="7" rx="1.2" fill="#0052ff" />
    </g>,
  ),
  rainbow: tile(
    "#001e59",
    <g fill="none" strokeLinecap="butt">
      <path d="M8 27a15 15 0 0 1 15-15" stroke="#ff4000" strokeWidth="3.4" transform="translate(-1 -1)" />
      <path d="M8 27a11 11 0 0 1 11-11" stroke="#ffb800" strokeWidth="3.4" transform="translate(1 1)" />
      <path d="M10 28a7 7 0 0 1 7-7" stroke="#01da40" strokeWidth="3.4" transform="translate(1 0)" />
      <path d="M10 28a3 3 0 0 1 3-3" stroke="#00aaff" strokeWidth="3.4" transform="translate(1 -1)" />
    </g>,
  ),
  rabby: tile("#7084ff", <path d="M9 21c0-6 5-10 11-10 5 0 7 3 7 6 0 2-2 3-4 3h-7c-1.5 0-2.5 1-2.5 2.5S14.5 25 16 25h6" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" />),
  trust: tile("#0500ff", <path d="M18 8l8 3v6c0 5-3.4 9-8 11-4.6-2-8-6-8-11v-6l8-3z" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" />),
  phantom: tile(
    "#ab9ff2",
    <g>
      <path d="M8 22c0-7 4.5-12 10.5-12S28 14 28 18.5c0 2.8-1.6 4.5-4 4.5H8z" fill="#fff" />
      <circle cx="19" cy="17" r="1.4" fill="#ab9ff2" />
      <circle cx="23.5" cy="17" r="1.4" fill="#ab9ff2" />
    </g>,
  ),
  brave: tile("#fb542b", <path d="M18 8l7 2.5 1.5 4-2 9L18 28l-6.5-4.5-2-9 1.5-4L18 8z" fill="#fff" />),
  walletconnect: tile(
    "#3b99fc",
    <path d="M11 15.5c3.9-3.8 10.1-3.8 14 0M13.5 18.3c2.5-2.4 6.5-2.4 9 0M10 20l3.5 3.4L18 19l4.5 4.4L26 20" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />,
  ),
};

export function WalletLogo({ id, name, icon, className = "size-9" }: { id: string; name: string; icon?: string; className?: string }) {
  const safe = icon && /^data:image\/(svg\+xml|png|webp|jpeg|gif)[;,]/.test(icon) ? icon : "";
  if (safe) return <img src={safe} alt="" className={`${className} shrink-0 rounded-xl`} />;
  const mark = MARKS[id];
  if (mark) return <span className={`${className} block shrink-0 overflow-hidden rounded-xl`}>{mark}</span>;
  return (
    <span className={`${className} grid shrink-0 place-items-center rounded-xl bg-white/10 text-[13px] font-bold text-white`} aria-hidden>
      {name.slice(0, 1)}
    </span>
  );
}
