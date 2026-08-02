import React from "react";

export type ScrollShadowProps = React.HTMLAttributes<HTMLElement> & {
  as?: React.ElementType;
  orientation?: "vertical" | "horizontal";
  offset?: number;
  size?: number;
  isEnabled?: boolean;
  hideTopShadow?: boolean;
  hideBottomShadow?: boolean;
  observeMutations?: boolean;
  onVisibilityChange?: (state: "both" | "none" | "top" | "bottom" | "left" | "right") => void;
};

function mergeRefs<T>(...refs: Array<React.Ref<T>>): React.RefCallback<T> {
  return (value) => {
    refs.forEach((ref) => {
      if (typeof ref === "function") {
        ref(value);
      } else if (ref && typeof ref === "object") {
        (ref as React.MutableRefObject<T | null>).current = value;
      }
    });
  };
}

const SELF_MANAGED_ATTRS = new Set([
  "data-top-scroll",
  "data-bottom-scroll",
  "data-top-bottom-scroll",
  "data-left-scroll",
  "data-right-scroll",
  "data-left-right-scroll",
  "style",
  "data-orientation",
  "data-scroll-shadow",
  "class",
]);

export const ScrollShadow = React.forwardRef<HTMLElement, ScrollShadowProps>(
  (
    {
      as: Component = "div",
      orientation = "vertical",
      offset = 0,
      size = 48,
      isEnabled = true,
      hideTopShadow = false,
      hideBottomShadow = false,
      observeMutations = true,
      onVisibilityChange,
      style,
      className,
      children,
      ...rest
    },
    ref,
  ) => {
    const internalRef = React.useRef<HTMLElement>(null);
    const visibleRef = React.useRef<"both" | "none" | "top" | "bottom" | "left" | "right">("none");
    const progressRef = React.useRef<number>(0);
    const shadowStateRef = React.useRef<{ before: boolean; after: boolean } | null>(null);
    const updatingRef = React.useRef(false);

    const dataScrollShadow = (rest as Record<string, unknown>)["data-scroll-shadow"];
    delete (rest as Record<string, unknown>)["data-scroll-shadow"];

    const mergedStyle = React.useMemo<React.CSSProperties>(() => {
      const next: React.CSSProperties = {
        ...(style as React.CSSProperties),
      };
      (next as Record<string, string>)["--scroll-shadow-size"] = `${size}px`;
      (next as Record<string, string>)["--scroll-progress"] = String(progressRef.current);
      return next;
    }, [size, style]);

    const setAttributes = React.useCallback(
      (el: HTMLElement, hasBefore: boolean, hasAfter: boolean, prefix: "top" | "left", suffix: "bottom" | "right") => {
        const beforeAttr = `data-${prefix}-scroll`;
        const afterAttr = `data-${suffix}-scroll`;
        const bothAttr = `data-${prefix}-${suffix}-scroll`;

        if (hasBefore && hasAfter) {
          if (el.getAttribute(bothAttr) !== "true") {
            el.setAttribute(bothAttr, "true");
          }
          if (el.hasAttribute(beforeAttr)) el.removeAttribute(beforeAttr);
          if (el.hasAttribute(afterAttr)) el.removeAttribute(afterAttr);
          return;
        }

        if (el.hasAttribute(bothAttr)) el.removeAttribute(bothAttr);
        const beforeValue = String(hasBefore);
        const afterValue = String(hasAfter);
        if (el.getAttribute(beforeAttr) !== beforeValue) {
          el.setAttribute(beforeAttr, beforeValue);
        }
        if (el.getAttribute(afterAttr) !== afterValue) {
          el.setAttribute(afterAttr, afterValue);
        }
      },
      [],
    );

    const clearAttributes = React.useCallback((el: HTMLElement) => {
      ["top", "bottom", "top-bottom", "left", "right", "left-right"].forEach((attr) => {
        const name = `data-${attr}-scroll`;
        if (el.hasAttribute(name)) el.removeAttribute(name);
      });
    }, []);

    const checkOverflow = React.useCallback(() => {
      const el = internalRef.current;
      if (!el) return;

      if (!isEnabled) {
        if (shadowStateRef.current !== null) {
          updatingRef.current = true;
          clearAttributes(el);
          shadowStateRef.current = null;
          updatingRef.current = false;
        }
        return;
      }

      // Subpixel tolerance: on hi-DPI (Retina) and with fractional scrollTop,
      // scrollTop+clientHeight can fall ~0.5px short of scrollHeight at the very end,
      // which would otherwise keep the bottom fade visible after fully scrolling.
      const SUBPIXEL_TOLERANCE = 1;
      const hasBefore =
        orientation === "vertical"
          ? el.scrollTop > offset + SUBPIXEL_TOLERANCE
          : el.scrollLeft > offset + SUBPIXEL_TOLERANCE;
      let hasAfter =
        orientation === "vertical"
          ? el.scrollHeight - (el.scrollTop + el.clientHeight) > offset + SUBPIXEL_TOLERANCE
          : el.scrollWidth - (el.scrollLeft + el.clientWidth) > offset + SUBPIXEL_TOLERANCE;

      const effectiveHasBefore = hideTopShadow && orientation === "vertical" ? false : hasBefore;

      if (hideBottomShadow && orientation === "vertical") {
        hasAfter = false;
      }

      const prevShadow = shadowStateRef.current;
      const shadowChanged = !prevShadow
        || prevShadow.before !== effectiveHasBefore
        || prevShadow.after !== hasAfter;

      if (shadowChanged) {
        updatingRef.current = true;
        setAttributes(
          el,
          effectiveHasBefore,
          hasAfter,
          orientation === "vertical" ? "top" : "left",
          orientation === "vertical" ? "bottom" : "right",
        );
        shadowStateRef.current = { before: effectiveHasBefore, after: hasAfter };
        updatingRef.current = false;
      }

      const next = effectiveHasBefore && hasAfter
        ? "both"
        : effectiveHasBefore
          ? (orientation === "vertical" ? "top" : "left")
          : hasAfter
            ? (orientation === "vertical" ? "bottom" : "right")
            : "none";
      if (next !== visibleRef.current) {
        visibleRef.current = next;
        onVisibilityChange?.(next);
      }

      if (orientation === "vertical") {
        const scrollable = el.scrollHeight - el.clientHeight;
        const progress = scrollable > 0 ? Math.min(1, Math.max(0, el.scrollTop / scrollable)) : 0;
        // Quantize to avoid float chatter rewriting --scroll-progress every frame.
        const quantized = Math.round(progress * 1000) / 1000;
        if (quantized !== progressRef.current) {
          progressRef.current = quantized;
          updatingRef.current = true;
          el.style.setProperty("--scroll-progress", String(quantized));
          updatingRef.current = false;
        }
      }
    }, [clearAttributes, hideTopShadow, hideBottomShadow, isEnabled, offset, onVisibilityChange, orientation, setAttributes]);

    React.useEffect(() => {
      const el = internalRef.current;
      if (!el) return;

      // Throttle with RAF to avoid excessive calls during rapid DOM changes
      let rafId: number | null = null;
      const throttledCheck = () => {
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          checkOverflow();
        });
      };

      const handleScroll = () => checkOverflow(); // Scroll should be immediate
      const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(throttledCheck) : null;
      const mutationObserver =
        observeMutations && typeof MutationObserver !== "undefined"
          ? new MutationObserver((records) => {
              if (updatingRef.current) return;
              // Ignore mutations we authored (data-*-scroll / style). Watching
              // those re-entered checkOverflow every frame and pegged mobile CPU
              // when the sidebar ScrollShadow + chat list were both mounted.
              for (const record of records) {
                if (record.type !== "attributes") {
                  throttledCheck();
                  return;
                }
                const attr = record.attributeName;
                if (!attr || !SELF_MANAGED_ATTRS.has(attr)) {
                  throttledCheck();
                  return;
                }
              }
            })
          : null;

      checkOverflow();

      el.addEventListener("scroll", handleScroll, { passive: true });
      resizeObserver?.observe(el);
      mutationObserver?.observe(el, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });

      return () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        el.removeEventListener("scroll", handleScroll);
        resizeObserver?.disconnect();
        mutationObserver?.disconnect();
      };
    }, [checkOverflow, observeMutations]);

    return (
      <Component
        {...rest}
        ref={mergeRefs(internalRef, ref)}
        className={className}
        data-orientation={orientation}
        data-scroll-shadow={dataScrollShadow ?? true}
        style={mergedStyle}
      >
        {children}
      </Component>
    );
  },
);

ScrollShadow.displayName = "ScrollShadow";
