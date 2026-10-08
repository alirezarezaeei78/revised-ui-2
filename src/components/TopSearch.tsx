"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Search } from "lucide-react";
import { minimumSearchLength, normalizeText, searchIndex, searchTools } from "@/src/lib/toolSearch";

export function TopSearch({ lockedToolSlugs = [] }: { lockedToolSlugs?: string[] }) {
  const pathname = usePathname();

  return <TopSearchInner key={pathname} lockedToolSlugs={lockedToolSlugs} />;
}

function TopSearchInner({ lockedToolSlugs }: { lockedToolSlugs: string[] }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const canSearch = normalizeText(query).length >= minimumSearchLength;
  const results = useMemo(() => searchTools(query, lockedToolSlugs), [lockedToolSlugs, query]);
  const fallbackItems = useMemo(() => {
    const lockedTools = new Set(lockedToolSlugs);
    return searchIndex
      .filter((item) => !lockedTools.has(item.slug))
      .map(({ slug, title, subtitle, categoryTitle, haystack }) => ({ slug, title, subtitle, categoryTitle, haystack }));
  }, [lockedToolSlugs]);
  const open = focused && query.trim().length > 0;

  useEffect(() => {
    function closeOnOutsideEvent(event: Event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setFocused(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideEvent);
    document.addEventListener("touchstart", closeOnOutsideEvent, { passive: true });
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideEvent);
      document.removeEventListener("touchstart", closeOnOutsideEvent);
    };
  }, []);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const syncValue = () => {
      setQuery(input.value);
      setFocused(true);
    };

    input.addEventListener("input", syncValue);
    input.addEventListener("search", syncValue);
    input.addEventListener("keyup", syncValue);
    input.addEventListener("focus", syncValue);
    input.addEventListener("compositionend", syncValue);

    return () => {
      input.removeEventListener("input", syncValue);
      input.removeEventListener("search", syncValue);
      input.removeEventListener("keyup", syncValue);
      input.removeEventListener("focus", syncValue);
      input.removeEventListener("compositionend", syncValue);
    };
  }, []);

  useEffect(() => {
    const root = wrapperRef.current;
    if (root) {
      root.dataset.reactMounted = "true";
      const reactPanel = root.querySelector(".top-search-panel") as HTMLElement;
      if (reactPanel) {
        reactPanel.style.display = "";
      }
    }
  }, []);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    const firstResult = results[0]?.item;
    if (firstResult) {
      event.preventDefault();
      window.location.href = `/calculators/${firstResult.slug}`;
    }
  }

  return (
    <div className={`top-search ${open ? "open" : ""}`} ref={wrapperRef} suppressHydrationWarning>
      <form action="/search" method="get" onSubmit={submitSearch}>
        <Search size={18} aria-hidden="true" />
        <input
          ref={inputRef}
          name="q"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onFocus={() => setFocused(true)}
          placeholder="جستجوی ابزار، IP، RAID، لنز..."
          aria-label="جستجوی ابزارها"
        />
      </form>

      <div
        className="top-search-panel"
        hidden={!open}
      >
        {canSearch ? (
          results.length > 0 ? (
            results.map(({ item }) => (
              <Link key={item.slug} href={`/calculators/${item.slug}`} onClick={() => setFocused(false)}>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.categoryTitle} · {item.subtitle}</small>
                </span>
                <ChevronLeft size={16} aria-hidden="true" />
              </Link>
            ))
          ) : (
            <p>ابزاری با این عبارت پیدا نشد.</p>
          )
        ) : (
          <p>برای جستجوی دقیق حداقل ۴ کاراکتر وارد کنید.</p>
        )}
      </div>
      <div
        className="top-search-panel vanilla-search-panel"
        hidden
        suppressHydrationWarning
        data-vanilla-panel
        dangerouslySetInnerHTML={{ __html: "" }}
      />
      <div
        style={{ display: "none" }}
        dangerouslySetInnerHTML={{
          __html:
            `<script type="application/json" data-top-search-items>` +
            JSON.stringify(fallbackItems).replace(/</g, "\\u003c") +
            `</script>
            <script>
(() => {
  const script = document.currentScript;
  const root = script && script.closest(".top-search");
  if (!root || root.dataset.nativeSearchReady === "true") return;
  root.dataset.nativeSearchReady = "true";

  const input = root.querySelector('input[name="q"]');
  const reactPanel = root.querySelector(".top-search-panel");
  const dataNode = root.querySelector("[data-top-search-items]");
  const vanillaPanel = root.querySelector("[data-vanilla-panel]");
  if (!input || !reactPanel || !dataNode || !vanillaPanel) return;

  let items = [];
  try {
    items = JSON.parse(dataNode.textContent || "[]");
  } catch {
    items = [];
  }

  const normalize = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[ي]/g, "ی")
      .replace(/[ك]/g, "ک")
      .replace(/[‌ـ]/g, " ")
      .replace(/[^\\p{L}\\p{N}.\\/\\s-]/gu, " ")
      .replace(/\\s+/g, " ")
      .trim();

  const makeIcon = () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m15 18-6-6 6-6");
    svg.appendChild(path);
    return svg;
  };

  const addMessage = (text) => {
    const p = document.createElement("p");
    p.textContent = text;
    vanillaPanel.appendChild(p);
  };

  const render = () => {
    if (root.dataset.reactMounted === "true") return;
    
    const rawQuery = input.value || "";
    const normalizedQuery = normalize(rawQuery);
    vanillaPanel.replaceChildren();

    if (!rawQuery.trim()) {
      vanillaPanel.hidden = true;
      reactPanel.style.display = "";
      root.classList.remove("open");
      return;
    }

    vanillaPanel.hidden = false;
    reactPanel.style.display = "none";
    root.classList.add("open");

    if (normalizedQuery.length < ${minimumSearchLength}) {
      addMessage("برای جستجوی دقیق حداقل ۴ کاراکتر وارد کنید.");
      return;
    }

    const terms = normalizedQuery.split(" ").filter(Boolean);
    const results = items
      .map((item) => {
        const title = normalize(item.title);
        const category = normalize(item.categoryTitle);
        const score = terms.reduce((sum, term) => {
          if (title === normalizedQuery) return sum + 10;
          if (title.includes(term)) return sum + 5;
          if (category.includes(term)) return sum + 3;
          if (String(item.slug).includes(term)) return sum + 3;
          if (String(item.haystack || "").includes(term)) return sum + 1;
          return sum;
        }, 0);
        return { item, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || String(a.item.title).localeCompare(String(b.item.title), "fa"))
      .slice(0, 7);

    if (!results.length) {
      addMessage("ابزاری با این عبارت پیدا نشد.");
      return;
    }

    for (const { item } of results) {
      const link = document.createElement("a");
      link.href = "/calculators/" + item.slug;
      const text = document.createElement("span");
      const title = document.createElement("strong");
      const subtitle = document.createElement("small");
      title.textContent = item.title;
      subtitle.textContent = item.categoryTitle + " · " + item.subtitle;
      text.append(title, subtitle);
      link.append(text, makeIcon());
      vanillaPanel.appendChild(link);
    }
  };

  input.addEventListener("input", render);
  input.addEventListener("search", render);
  input.addEventListener("keyup", render);
  input.addEventListener("focus", render);
  input.addEventListener("compositionend", render);
  document.addEventListener("touchstart", (event) => {
    if (root.dataset.reactMounted === "true") return;
    if (!root.contains(event.target)) {
      vanillaPanel.hidden = true;
      reactPanel.style.display = "";
      root.classList.remove("open");
    }
  }, { passive: true });
})();
            </script>`
        }}
      />
    </div>
  );
}
