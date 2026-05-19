import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

// WHY threshold instead of exact match: scrollHeight - scrollTop - clientHeight
// is often off by 1-2px due to fractional rendering. A 50px threshold means
// "close enough to the bottom" — the user hasn't intentionally scrolled up.
const NEAR_BOTTOM_THRESHOLD = 50;

/**
 * Auto-scrolls a container to the bottom when dependencies change,
 * but only if the user hasn't scrolled up. Returns a ref to attach
 * to the scrollable container.
 */
export function useAutoScroll(deps: unknown[]): {
  ref: RefObject<HTMLDivElement | null>;
  scrollToBottom: () => void;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const isNearBottom = useRef(true);

  const scrollToBottom = useCallback(() => {
    isNearBottom.current = true;
    const el = ref.current;
    if (!el) return;
    el.scrollTo(0, el.scrollHeight);
    const frame = requestAnimationFrame(() => {
      const current = ref.current;
      if (current) current.scrollTo(0, current.scrollHeight);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Track scroll position to detect if user scrolled up
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      isNearBottom.current = scrollHeight - scrollTop - clientHeight < NEAR_BOTTOM_THRESHOLD;
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // Scroll after layout so optimistic rows replaced by persisted rows still
  // land at the true bottom even when the message count has not changed.
  useLayoutEffect(() => {
    if (!isNearBottom.current) return;
    return scrollToBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ref, scrollToBottom };
}
