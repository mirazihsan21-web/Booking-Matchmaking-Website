"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

const GAP = 12 + 12; // the room's gap above the chat box, and a little air under it
const MIN = 160;

/**
 * The height for a chat's scrolling list so that, with the page at the top, the list and what sits under it (the
 * chat box) fit the screen above the phone's bottom tab bar — so the box is there to type in without scrolling.
 * The screen's height, less everything above the list, less `below`, less the tab bar; never under 160px.
 * Measured again when the window or anything on the page changes size (a card strip appears, a photo is picked).
 * The screen height is the page's own (`clientHeight`), which an on-screen keyboard doesn't shrink, so typing
 * doesn't make the list jump. `null` until measured: the list keeps its CSS height for the first paint.
 */
export function useFitHeight(list: RefObject<HTMLElement | null>, below: RefObject<HTMLElement | null>): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = list.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const tabBar = document.querySelector<HTMLElement>("[data-bottom-nav]")?.offsetHeight ?? 0;
      const under = below.current?.offsetHeight ?? 0;
      const fit = Math.floor(document.documentElement.clientHeight - top - under - tabBar - GAP);
      setHeight(Math.max(MIN, fit)); // the same number again doesn't re-render, so measuring can't loop
    };
    // A ResizeObserver reports once as soon as it starts (before the next paint), which is the first measure.
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    if (below.current) observer.observe(below.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [list, below]);
  return height;
}
