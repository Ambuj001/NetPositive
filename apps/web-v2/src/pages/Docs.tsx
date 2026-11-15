import { ChevronDown, Link2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { Aurora, PageHead, cx } from "../components/ui";
import { DOC_SECTIONS, resolveDocSection } from "../content/docs";
import { displayTerms } from "../lib/displayTerms";
import { useTerms } from "../lib/useTerms";
import { usePageTitle } from "../lib/usePageTitle";
import { useWorldIdOn } from "../lib/world";

const wrap = "mx-auto w-full max-w-[1200px] px-5 md:px-8";

/** `/docs/fees` and friends land on the matching section of the one docs page. Unknown names open the top. */
export function DocsSectionRedirect() {
  const { section } = useParams();
  const id = resolveDocSection(section);
  return <Navigate to={id ? `/docs#${id}` : "/docs"} replace />;
}

const GROUPS = DOC_SECTIONS.reduce<{ name: string; items: typeof DOC_SECTIONS }[]>((acc, s) => {
  const last = acc[acc.length - 1];
  if (last && last.name === s.group) last.items.push(s);
  else acc.push({ name: s.group, items: [s] });
  return acc;
}, []);

export default function Docs() {
  usePageTitle("Docs", "How NetPositive works: the two sides of a trade, fees, time limits, disputes, safety and contract details.");
  const { terms, loading } = useTerms();
  const v = useMemo(() => displayTerms(terms), [terms]);
  const worldIdOn = useWorldIdOn();
  const { hash } = useLocation();
  const [active, setActive] = useState(() => resolveDocSection(hash.slice(1)) ?? DOC_SECTIONS[0].id);
  const [tocOpen, setTocOpen] = useState(false);

  useEffect(() => {
    const id = resolveDocSection(hash.slice(1));
    if (id) setActive(id);
    setTocOpen(false);
  }, [hash]);

  // Highlight the section being read. The one nearest the top of the screen wins.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = DOC_SECTIONS.find((s) => seen.get(s.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-96px 0px -60% 0px" },
    );
    for (const s of DOC_SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  const toc = (
    <nav aria-label="Docs sections" className="space-y-5">
      {GROUPS.map((g) => (
        <div key={g.name}>
          <div className="mb-1.5 px-3 text-[12px] font-medium text-dim">{g.name}</div>
          <ul>
            {g.items.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/docs#${s.id}`}
                  aria-current={active === s.id ? "location" : undefined}
                  className={cx("block rounded-lg px-3 py-2 text-[14.5px] transition-colors", active === s.id ? "bg-sunken font-medium text-fg" : "text-mute hover:text-fg")}
                >
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="relative pt-12 pb-10 md:pt-16">
      <Aurora />
      <div className={cx(wrap, "relative")}>
        <PageHead eyebrow="Docs" title="How NetPositive works" sub="What the two people in a trade do, what it costs, what happens when something goes wrong, and what is not solved yet. Written for people using the app, not for developers." />

        <p role="status" className="mt-5 flex items-start gap-2 text-[13px] leading-relaxed text-mute">
          <span className={cx("mt-[6px] size-1.5 shrink-0 rounded-full", v.mock ? "bg-amber" : v.live ? "bg-pos" : loading ? "animate-pulse bg-dim" : "bg-amber")} />
          {v.mock
            ? "This site is connected to a development server with a simulated escrow. The fee, limits and time windows on this page are that server's test settings, not the live contract's."
            : v.live
            ? "Fees, limits and time windows on this page are the current values, read from the escrow contract."
            : loading
              ? "Loading the current fee, limits and time windows. Until then this page shows the launch values."
              : "The current values couldn't be loaded, so fees, limits and time windows on this page are the launch values. They may have changed; the app shows the real ones before you lock anything."}
        </p>

        {/* Phone and tablet: the section list folds away above the text. */}
        <div className="mt-8 rounded-2xl border border-line bg-surface lg:hidden">
          <button type="button" onClick={() => setTocOpen((o) => !o)} aria-expanded={tocOpen} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-[15px] font-medium">
            <span className="min-w-0 truncate">
              <span className="text-mute">On this page · </span>
              {DOC_SECTIONS.find((s) => s.id === active)?.title}
            </span>
            <ChevronDown className={cx("size-4 shrink-0 text-mute transition-transform", tocOpen && "rotate-180")} />
          </button>
          {tocOpen && <div className="border-t border-line p-2 pt-3">{toc}</div>}
        </div>

        <div className="mt-8 grid gap-12 lg:mt-12 lg:grid-cols-[230px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto pb-6">{toc}</div>
          </aside>

          <div className="min-w-0 max-w-[760px]">
            {DOC_SECTIONS.map((s, i) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className={cx("scroll-mt-24", i > 0 && "mt-14 border-t border-line pt-12")}>
                <div className="text-[13px] text-dim">{s.group}</div>
                <h2 id={`${s.id}-title`} className="group mt-1 flex items-center gap-2 text-[28px] font-semibold leading-[1.1] tracking-[-0.03em] md:text-[32px]">
                  {s.title}
                  <Link to={`/docs#${s.id}`} aria-label={`Link to "${s.title}"`} className="grid size-7 shrink-0 place-items-center rounded-full text-dim opacity-60 transition hover:bg-sunken hover:text-fg hover:opacity-100">
                    <Link2 className="size-4" />
                  </Link>
                </h2>
                <p className="mt-2 text-[16px] text-mute">{s.summary}</p>
                <div className="mt-6 space-y-4">{s.body(v, { worldIdOn })}</div>
              </section>
            ))}

            <div className="mt-14 rounded-2xl bg-sunken p-5 text-[14.5px] leading-relaxed text-mute md:p-6">
              These pages describe how the product works today. They are not legal or financial advice. See also the{" "}
              <Link to="/terms" className="link font-medium text-fg">
                terms summary
              </Link>{" "}
              and the{" "}
              <Link to="/privacy" className="link font-medium text-fg">
                privacy summary
              </Link>
              .
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
