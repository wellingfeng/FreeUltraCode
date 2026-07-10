import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Auto-hide scrollbar behaviour (CherryStudio-style).
 *
 * The scrollbar thumb stays hidden by default and only becomes visible while
 * the element is actively scrolling, or when the pointer hovers near the
 * scrollbar edge. Visibility is driven purely through CSS classes defined in
 * `styles/global.css`:
 *   - base container: `ugs-autohide-scroll`
 *   - while scrolling: `is-scrolling`
 *   - pointer near edge: `is-edge`
 */

const BASE_CLASS = "ugs-autohide-scroll";
const SCROLLING_CLASS = "is-scrolling";
const EDGE_CLASS = "is-edge";

/** Which edges of the element carry a scrollbar we should watch. */
type Axis = "y" | "x" | "both";

/**
 * Imperatively attach the auto-hide behaviour to an element. Returns a cleanup
 * function that removes listeners and classes. Intended for use inside a
 * `useEffect` where the element ref is already resolved.
 *
 * @param el            the scroll container
 * @param hideDelay     ms to keep the scrollbar visible after scrolling stops
 * @param edgeThreshold px distance from the scrollbar edge that counts as "near"
 * @param axis          which scrollbar edge(s) to watch for pointer proximity
 */
export function attachAutoHideScroll(
  el: HTMLElement,
  hideDelay = 900,
  edgeThreshold = 24,
  axis: Axis = "y",
): () => void {
  el.classList.add(BASE_CLASS);

  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const clearHideTimer = () => {
    if (hideTimer != null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const onScroll = () => {
    el.classList.add(SCROLLING_CLASS);
    clearHideTimer();
    hideTimer = setTimeout(() => {
      el.classList.remove(SCROLLING_CLASS);
    }, hideDelay);
  };

  const onPointerMove = (event: PointerEvent | MouseEvent) => {
    const rect = el.getBoundingClientRect();
    const nearVertical =
      (axis === "y" || axis === "both") &&
      rect.right - event.clientX <= edgeThreshold &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    const nearHorizontal =
      (axis === "x" || axis === "both") &&
      rect.bottom - event.clientY <= edgeThreshold &&
      event.clientY <= rect.bottom &&
      event.clientX >= rect.left &&
      event.clientX <= rect.right;
    el.classList.toggle(EDGE_CLASS, nearVertical || nearHorizontal);
  };

  const onPointerLeave = () => {
    el.classList.remove(EDGE_CLASS);
  };

  el.addEventListener("scroll", onScroll, { passive: true });
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerleave", onPointerLeave);

  return () => {
    clearHideTimer();
    el.removeEventListener("scroll", onScroll);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerleave", onPointerLeave);
    el.classList.remove(BASE_CLASS, SCROLLING_CLASS, EDGE_CLASS);
  };
}

/**
 * React hook wrapper around {@link attachAutoHideScroll}. Returns a ref to
 * assign to the scroll container element.
 */
export function useAutoHideScroll<T extends HTMLElement>(
  hideDelay = 900,
  edgeThreshold = 24,
  axis: Axis = "y",
): RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return attachAutoHideScroll(el, hideDelay, edgeThreshold, axis);
  }, [hideDelay, edgeThreshold, axis]);
  return ref;
}
