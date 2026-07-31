const TOAST_SELECTOR = "[data-sonner-toast]"
const TOASTER_SELECTOR = "[data-sonner-toaster]"

export function observePinnedToasterStyles(doc: Document, shadow: string) {
  let cleanupToastObserver: (() => void) | undefined

  const connect = () => {
    const root = doc.querySelector<HTMLElement>(TOASTER_SELECTOR)
    if (!root) return false
    cleanupToastObserver = observePinnedToastStyles(root, shadow)
    return true
  }

  if (connect()) return () => cleanupToastObserver?.()

  const rootObserver = new MutationObserver(() => {
    if (!connect()) return
    rootObserver.disconnect()
  })
  rootObserver.observe(doc.body, {
    childList: true,
    subtree: true,
  })

  return () => {
    rootObserver.disconnect()
    cleanupToastObserver?.()
  }
}

export function observePinnedToastStyles(root: HTMLElement, shadow: string) {
  const apply = (el: HTMLElement) => {
    if (
      el.style.getPropertyValue("box-shadow") !== shadow
      || el.style.getPropertyPriority("box-shadow") !== "important"
    ) {
      el.style.setProperty("box-shadow", shadow, "important")
    }
    if (
      el.style.getPropertyValue("outline") !== "none"
      || el.style.getPropertyPriority("outline") !== "important"
    ) {
      el.style.setProperty("outline", "none", "important")
    }
    if (el.getAttribute("tabindex") === "0") el.setAttribute("tabindex", "-1")
  }

  root.querySelectorAll<HTMLElement>(TOAST_SELECTOR).forEach(apply)

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.type === "attributes"
        && mutation.target instanceof HTMLElement
        && mutation.target.matches(TOAST_SELECTOR)
      ) {
        apply(mutation.target)
      }
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return
        if (node.matches(TOAST_SELECTOR)) apply(node)
        node.querySelectorAll<HTMLElement>(TOAST_SELECTOR).forEach(apply)
      })
    }
  })

  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "tabindex", "data-expanded", "data-swiping"],
  })

  return () => observer.disconnect()
}
