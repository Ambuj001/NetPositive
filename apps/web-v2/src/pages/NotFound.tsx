import { ArrowRight } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Button, DotText, cx } from "../components/ui";
import { usePageTitle } from "../lib/usePageTitle";

const wrap = "mx-auto w-full max-w-[1200px] px-5 md:px-8";

/** Shown for any address the app doesn't know. `/` stays the landing page. */
export default function NotFound() {
  usePageTitle("Page not found");
  const { pathname } = useLocation();
  return (
    <section className={cx(wrap, "flex min-h-[62vh] flex-col items-center justify-center py-20 text-center")} data-testid="not-found">
      <DotText text="404" className="text-[96px] leading-none text-brand md:text-[128px]" />
      <h1 className="mt-6 text-[30px] font-semibold tracking-[-0.035em] md:text-[38px]">Page not found</h1>
      <p className="mt-3 max-w-[460px] text-[16px] leading-relaxed text-mute">
        There is nothing at <span className="font-mono text-[14px] break-all text-fg">{pathname}</span>. The link may be old or mistyped. Your funds and orders are not affected.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button to="/" icon={<ArrowRight className="size-4" />}>
          Go to the home page
        </Button>
        <Button to="/docs" variant="outline">
          Read the docs
        </Button>
        <Button to="/track" variant="outline">
          My orders
        </Button>
      </div>
    </section>
  );
}
