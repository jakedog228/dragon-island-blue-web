import { icon, type IconName } from "./modIcons.js";

/** Tiny DOM kit shared by the in-game mod library and the author portal. User text is always text. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", ...children: (Node | string | undefined | false)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) if (child !== undefined && child !== false) node.append(child);
  return node;
}
export type ButtonTone = "primary" | "secondary" | "ghost" | "danger" | "success";
export function button(label: string, options: { icon?: IconName; tone?: ButtonTone; onClick?: () => void | Promise<void>; title?: string; small?: boolean } = {}): HTMLButtonElement {
  const node = el("button", `ml-btn ml-btn--${options.tone ?? "secondary"}${options.small ? " ml-btn--small" : ""}`);
  node.type = "button";
  if (options.icon) node.append(icon(options.icon));
  if (label) node.append(el("span", "", label));
  if (options.title) node.title = options.title;
  if (options.onClick) node.addEventListener("click", (event) => { event.stopPropagation(); void options.onClick!(); });
  return node;
}
/** Icon-only control; the label becomes its accessible name and tooltip. */
export function iconButton(name: IconName, label: string, onClick?: () => void | Promise<void>, tone: ButtonTone = "ghost"): HTMLButtonElement {
  const node = el("button", `ml-icon-btn ml-icon-btn--${tone}`, icon(name));
  node.type = "button"; node.title = label; node.setAttribute("aria-label", label);
  if (onClick) node.addEventListener("click", (event) => { event.stopPropagation(); void onClick(); });
  return node;
}
export function badge(label: string, tone: string, name?: IconName, title?: string): HTMLSpanElement {
  const node = el("span", `ml-badge ml-badge--${tone}`, name ? icon(name) : undefined, label);
  if (title) node.title = title;
  return node;
}
export function externalLink(href: string, label: string, name: IconName | null = "external", className = "ml-link"): HTMLAnchorElement {
  const link = el("a", className, el("span", "", label), name ? icon(name, "ml-icon ml-icon--small") : undefined);
  link.href = href; link.target = "_blank"; link.rel = "noopener noreferrer";
  return link;
}
/** A title, one sentence of direction, and what to do next. No decorative icon. */
export function emptyState(title: string, detail: string, ...actions: HTMLElement[]): HTMLElement {
  return el("div", "ml-empty", el("strong", "", title), el("p", "", detail),
    actions.length ? el("div", "ml-empty__actions", ...actions) : undefined);
}

/** Non-blocking status line; errors stay until the next message, info fades. */
export class Toaster {
  readonly node = el("div", "ml-toasts");
  constructor() { this.node.setAttribute("role", "status"); this.node.setAttribute("aria-live", "polite"); }
  show(message: string, tone: "info" | "success" | "error" = "info"): void {
    const toast = el("div", `ml-toast ml-toast--${tone}`, el("span", "", message));
    const dismiss = iconButton("close", "Dismiss", () => toast.remove());
    toast.append(dismiss);
    this.node.replaceChildren(toast);
    if (tone !== "error") setTimeout(() => toast.remove(), 4500);
  }
  clear(): void { this.node.replaceChildren(); }
}

/**
 * A modal sheet inside a host (the library is itself a <dialog>, so a second top-layer dialog
 * would fight it for focus). Resolves with the chosen action; Escape and backdrop cancel.
 */
export function sheet<T extends string>(host: HTMLElement, content: {
  tone?: "info" | "danger" | "warning"; title: string; body: (Node | string)[];
  actions: { id: T; label: string; tone?: ButtonTone; icon?: IconName }[];
}): Promise<T | "cancel"> {
  return new Promise((resolve) => {
    const backdrop = el("div", "ml-sheet-backdrop");
    const panel = el("div", `ml-sheet ml-sheet--${content.tone ?? "info"}`);
    panel.setAttribute("role", "alertdialog"); panel.setAttribute("aria-modal", "true");
    const heading = el("h3", "", content.title); heading.id = `ml-sheet-${Math.random().toString(36).slice(2)}`;
    panel.setAttribute("aria-labelledby", heading.id);
    const previous = document.activeElement as HTMLElement | null;
    const finish = (result: T | "cancel"): void => {
      backdrop.remove(); host.removeEventListener("keydown", onKey, true); previous?.focus?.(); resolve(result);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish("cancel"); }
    };
    const footer = el("div", "ml-sheet__actions", button("Cancel", { tone: "ghost", onClick: () => finish("cancel") }));
    for (const action of content.actions) {
      footer.append(button(action.label, { tone: action.tone ?? "primary", ...(action.icon ? { icon: action.icon } : {}), onClick: () => finish(action.id) }));
    }
    panel.append(el("div", "ml-sheet__head", heading), el("div", "ml-sheet__body", ...content.body), footer);
    backdrop.append(panel);
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) finish("cancel"); });
    host.addEventListener("keydown", onKey, true);
    host.append(backdrop);
    (footer.lastElementChild as HTMLElement).focus();
  });
}

export function coverImage(src: string, alt: string, className = "ml-cover"): HTMLElement {
  const img = el("img", "");
  img.src = src; img.alt = alt; img.loading = "lazy"; img.decoding = "async";
  return el("div", className, img);
}
