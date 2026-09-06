import "./moddingGuide.css";
import { installContentGateThemeToggle } from "../content/contentGateTheme.js";

// The guide shares the loader's color-mode preference: `installContentGateThemeToggle` writes
// `data-gate-mode` on the element it is given, and the stylesheet keys light mode off <html>.
installContentGateThemeToggle(document.documentElement);

installNavigation();
installSearch();
installCopyButtons();
void reportDownloadAvailability();

/** Highlights the rail entry for the heading nearest the top of the viewport and collapses the
 * rail on narrow screens after a choice. */
function installNavigation(): void {
  const rail = document.getElementById("rail");
  const toggle = document.querySelector<HTMLButtonElement>("[data-nav-toggle]");
  if (rail === null || toggle === null) return;
  const links = [...rail.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
  const byId = new Map(links.map((link) => [link.hash.slice(1), link]));
  const targets = [...byId.keys()]
    .map((id) => document.getElementById(id))
    .filter((element): element is HTMLElement => element !== null);

  let current: HTMLAnchorElement | undefined;
  const select = (id: string): void => {
    const link = byId.get(id);
    if (link === undefined || link === current) return;
    current?.removeAttribute("aria-current");
    link.setAttribute("aria-current", "true");
    current = link;
    const railBox = rail.getBoundingClientRect();
    const linkBox = link.getBoundingClientRect();
    if (linkBox.top < railBox.top || linkBox.bottom > railBox.bottom) {
      rail.scrollTop += linkBox.top < railBox.top
        ? linkBox.top - railBox.top : linkBox.bottom - railBox.bottom;
    }
  };

  const update = (): void => {
    const line = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) + 1;
    let best: HTMLElement | undefined;
    for (const target of targets) {
      if (target.getBoundingClientRect().top <= line) best = target;
      else break;
    }
    select((best ?? targets[0])?.id ?? "");
  };
  let frame = 0;
  const schedule = (): void => {
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);
  update();

  toggle.hidden = false;
  rail.dataset["navReady"] = "";
  const setOpen = (open: boolean): void => {
    toggle.setAttribute("aria-expanded", String(open));
    if (open) rail.dataset["open"] = "";
    else delete rail.dataset["open"];
  };
  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
  rail.addEventListener("click", (event) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
    if (link !== null) {
      setOpen(false);
      focusAnchor(link.hash.slice(1));
    }
  });
  addEventListener("keydown", (event) => {
    if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      setOpen(false);
      toggle.focus();
    }
  });
}

interface SearchEntry {
  readonly text: string;
  readonly lower: string;
  readonly crumb: string;
  readonly anchor: string;
}

/** Indexes headings, code identifiers, and table rows so a filename, localization key, or
 * loader message pasted from the status line lands on the gate that produced it. */
function installSearch(): void {
  const host = document.querySelector<HTMLElement>("[data-search]");
  const input = document.getElementById("doc-search") as HTMLInputElement | null;
  const results = document.getElementById("doc-search-results");
  if (host === null || input === null || results === null) return;

  const entries = buildSearchIndex();
  host.hidden = false;
  let selected = -1;
  let shown: SearchEntry[] = [];

  const close = (): void => {
    results.hidden = true;
    results.replaceChildren();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    selected = -1;
    shown = [];
  };

  const render = (): void => {
    const query = input.value.trim().toLowerCase();
    if (query.length < 2) {
      close();
      return;
    }
    shown = rank(entries, query).slice(0, 12);
    input.removeAttribute("aria-activedescendant");
    results.replaceChildren();
    if (shown.length === 0) {
      const empty = document.createElement("p");
      empty.className = "search-results__empty";
      empty.textContent =
        `No match for “${input.value.trim()}”. Search by exact filename, localization key, ` +
        "or the loader's status-line message.";
      results.appendChild(empty);
    } else {
      shown.forEach((entry, index) => {
        const link = document.createElement("a");
        link.href = `#${entry.anchor}`;
        link.setAttribute("role", "option");
        link.id = `doc-search-option-${index}`;
        const crumb = document.createElement("span");
        crumb.className = "search-results__crumb";
        crumb.textContent = entry.crumb;
        const hit = document.createElement("span");
        hit.className = "search-results__hit";
        hit.append(...highlight(entry.text, query));
        link.append(crumb, hit);
        link.addEventListener("click", () => {
          close();
          focusAnchor(entry.anchor);
        });
        results.appendChild(link);
      });
    }
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
    selected = -1;
  };

  const move = (delta: number): void => {
    if (shown.length === 0) return;
    selected = selected === -1
      ? (delta > 0 ? 0 : shown.length - 1)
      : (selected + delta + shown.length) % shown.length;
    results.querySelectorAll("a").forEach((link, index) => {
      if (index === selected) link.setAttribute("aria-selected", "true");
      else link.removeAttribute("aria-selected");
    });
    input.setAttribute("aria-activedescendant", `doc-search-option-${selected}`);
    const option = results.children[selected];
    if (option !== undefined) {
      const box = option.getBoundingClientRect();
      const viewport = results.getBoundingClientRect();
      if (box.top < viewport.top) results.scrollTop += box.top - viewport.top;
      else if (box.bottom > viewport.bottom) results.scrollTop += box.bottom - viewport.bottom;
    }
  };

  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
    else if (event.key === "Enter") {
      const target = shown[selected === -1 ? 0 : selected];
      if (target === undefined) return;
      event.preventDefault();
      location.hash = target.anchor;
      close();
      focusAnchor(target.anchor);
    } else if (event.key === "Escape") {
      close();
      input.blur();
    }
  });
  document.addEventListener("click", (event) => {
    if (!host.contains(event.target as Node)) close();
  });
  addEventListener("keydown", (event) => {
    const active = document.activeElement;
    const typing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable);
    if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      input.focus();
      input.select();
    }
  });
}

function focusAnchor(id: string): void {
  const target = document.getElementById(id);
  if (target === null) return;
  target.tabIndex = -1;
  target.focus({ preventScroll: true });
}

function buildSearchIndex(): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const seen = new Set<string>();
  const add = (text: string, crumb: string, anchor: string): void => {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed.length === 0) return;
    const key = `${anchor}\u0000${trimmed.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ text: trimmed, lower: trimmed.toLowerCase(), crumb, anchor });
  };
  const nearestAnchor = (element: Element): { anchor: string; crumb: string } => {
    let node: Element | null = element;
    while (node !== null) {
      const heading = node.matches("h1[id], h2[id], h3[id]") ? node : null;
      if (heading !== null) {
        return { anchor: heading.id, crumb: crumbFor(heading) };
      }
      const previous = previousHeading(node);
      if (previous !== null) return { anchor: previous.id, crumb: crumbFor(previous) };
      if (node.matches("section[data-section][id]")) {
        return { anchor: node.id, crumb: node.querySelector("h1")?.textContent?.trim() ?? "" };
      }
      node = node.parentElement;
    }
    return { anchor: "start", crumb: "Start" };
  };

  for (const section of document.querySelectorAll<HTMLElement>(".doc section[data-section][id]")) {
    add(section.querySelector("h1")?.textContent ?? "", "Section", section.id);
  }
  for (const heading of document.querySelectorAll<HTMLElement>(".doc h1[id], .doc h2[id], .doc h3[id]")) {
    add(headingText(heading), crumbFor(heading, true), heading.id);
  }
  for (const row of document.querySelectorAll<HTMLTableRowElement>(".doc tbody tr")) {
    const { anchor, crumb } = nearestAnchor(row);
    for (const cell of row.cells) add(cell.textContent ?? "", crumb, anchor);
  }
  for (const code of document.querySelectorAll<HTMLElement>(".doc p code, .doc li code, .doc details code")) {
    const { anchor, crumb } = nearestAnchor(code);
    add(code.textContent ?? "", crumb, anchor);
  }
  return entries;
}

/** Heading text without the gate-number badge, so crumbs read "Egg reel resources", not "10Egg…". */
function headingText(heading: Element): string {
  return [...heading.childNodes]
    .filter((node) => !(node instanceof Element && node.classList.contains("gate")))
    .map((node) => node.textContent ?? "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function previousHeading(node: Element): HTMLElement | null {
  let sibling = node.previousElementSibling;
  while (sibling !== null) {
    if (sibling.matches("h1[id], h2[id], h3[id]")) return sibling as HTMLElement;
    sibling = sibling.previousElementSibling;
  }
  return null;
}

function crumbFor(heading: Element, self = false): string {
  const section = heading.closest("section[data-section]");
  const title = section?.querySelector("h1")?.textContent?.trim() ?? "";
  const own = headingText(heading);
  if (heading.tagName === "H1") return self ? "Section" : title;
  return title === "" || self ? title || own : `${title} / ${own}`;
}

function rank(entries: readonly SearchEntry[], query: string): SearchEntry[] {
  const scored: Array<[number, SearchEntry]> = [];
  for (const entry of entries) {
    const index = entry.lower.indexOf(query);
    if (index === -1) continue;
    const exact = entry.lower === query ? 0 : 1;
    const wordStart = index === 0 || /[\s./<>_-]/.test(entry.lower[index - 1] ?? "") ? 0 : 1;
    scored.push([exact * 4 + wordStart * 2 + Math.min(entry.text.length / 80, 1), entry]);
  }
  return scored.sort((a, b) => a[0] - b[0]).map(([, entry]) => entry);
}

function highlight(text: string, query: string): Node[] {
  const index = text.toLowerCase().indexOf(query);
  if (index === -1) return [document.createTextNode(text)];
  const mark = document.createElement("mark");
  mark.textContent = text.slice(index, index + query.length);
  return [
    document.createTextNode(text.slice(0, index)),
    mark,
    document.createTextNode(text.slice(index + query.length)),
  ];
}

function installCopyButtons(): void {
  if (!("clipboard" in navigator)) return;
  for (const block of document.querySelectorAll<HTMLPreElement>(".doc pre")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy code block");
    let reset: ReturnType<typeof setTimeout> | undefined;
    button.addEventListener("click", async () => {
      const text = block.querySelector("code")?.textContent ?? block.textContent ?? "";
      try {
        await navigator.clipboard.writeText(text);
        button.dataset["copied"] = "done";
        button.textContent = "Copied";
      } catch {
        button.dataset["copied"] = "failed";
        button.textContent = "Select and copy";
      }
      clearTimeout(reset);
      reset = setTimeout(() => {
        delete button.dataset["copied"];
        button.textContent = "Copy";
      }, 1600);
    });
    block.appendChild(button);
  }
}

/** The reference downloads are published separately from the engine build, so a host may not
 * carry them. Ask before the developer clicks: the dev/preview route answers 404 with a plain
 * explanation when the local artifact is absent. */
async function reportDownloadAvailability(): Promise<void> {
  const items = document.querySelectorAll<HTMLLIElement>("[data-downloads] li");
  await Promise.all([...items].map(async (item) => {
    const link = item.querySelector<HTMLAnchorElement>("a[data-download]");
    const state = item.querySelector<HTMLElement>("[data-download-state]");
    if (link === null || state === null) return;
    state.textContent = "Checking availability";
    try {
      const response = await fetch(link.href, { method: "HEAD", cache: "no-store" });
      const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim();
      if (response.ok && (mediaType === "application/zip" || mediaType === "application/octet-stream")) {
        const bytes = Number(response.headers.get("content-length"));
        state.textContent = Number.isFinite(bytes) && bytes > 0 ? formatBytes(bytes) : "Available";
        item.dataset["available"] = "true";
      } else if (response.status === 404 || mediaType === "text/html") {
        state.textContent = "Not published on this host";
        item.dataset["available"] = "false";
      } else {
        state.textContent = "";
      }
    } catch {
      // Offline or blocked; leave the plain link so the developer can still try it.
      state.textContent = "";
    }
  }));
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} B`;
}
