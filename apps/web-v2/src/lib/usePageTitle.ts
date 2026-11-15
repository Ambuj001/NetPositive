import { useEffect } from "react";

const SITE = "NetPositive";

/**
 * Sets the tab title (and the meta description, when given) while a page is shown, and puts back what index.html
 * had when the page is left. Pages that don't call it keep the site-wide title.
 */
export function usePageTitle(title: string, description?: string) {
  useEffect(() => {
    const prevTitle = document.title;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const prevDescription = meta?.content;
    document.title = `${title} · ${SITE}`;
    if (meta && description) meta.content = description;
    return () => {
      document.title = prevTitle;
      if (meta && prevDescription !== undefined) meta.content = prevDescription;
    };
  }, [title, description]);
}
