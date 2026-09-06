import type {
  CodeModManifestV4,
  CodeModPackage,
  ResolvedCodeModProfile,
} from "@dib/mod-kernel";
import { fullTrustModModules, type ModModuleCatalog } from "./modModuleCatalog.js";

export interface ModHostRegistry {
  list(): readonly string[];
  has(name: string): boolean;
  get<T = unknown>(name: string): T | undefined;
  require<T = unknown>(name: string): T;
  set(name: string, value: unknown): void;
  delete(name: string): boolean;
}

export interface FullTrustModPhase<T = unknown> {
  readonly name: string;
  readonly modId: string;
  value: T;
  readonly host: ModHostRegistry;
}

export type FullTrustModHook<T = unknown> = (
  event: FullTrustModPhase<T>,
) => void | T | Promise<void | T>;

/** Which mod touched a seam, and how. `replace`/`set` discard; `intercept`/`write` may compose. */
export interface ModSeamClaim {
  readonly modId: string;
  readonly action: "replace" | "intercept" | "set" | "write";
}

export type ModSeamKind = "property" | "service" | "data";

/** One contested point of the running game: a patched member, a service name, or a data path. */
export interface ModSeam {
  readonly kind: ModSeamKind;
  /** `BattleNode.prototype.sleep`, `host:content`, `content:loaded → data.strings`. */
  readonly target: string;
  /** Every claim in activation order. The last claim is the one the running game sees. */
  readonly claims: readonly ModSeamClaim[];
  readonly severity: "info" | "warning";
  readonly summary: string;
}

export interface ModProfileEntry {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly priority: number;
}

/**
 * What the active profile actually did to the same places, in load order — the mod-manager
 * conflict view. Full trust means overlap is legitimate, so nothing here blocks activation; the
 * report exists so overlap is visible and attributable instead of silent.
 */
export interface ModInterferenceReport {
  readonly order: readonly ModProfileEntry[];
  /** Seams claimed by two or more mods, most severe first. */
  readonly seams: readonly ModSeam[];
  /** The subset where a later mod discards an earlier mod's contribution. */
  readonly warnings: readonly ModSeam[];
}

export interface FullTrustModRuntime {
  readonly profile: ResolvedCodeModProfile;
  readonly host: ModHostRegistry;
  runPhase<T>(name: string, value: T): Promise<T>;
  interference(): ModInterferenceReport;
  dispose(): void;
}

export interface FullTrustModRuntimeOptions {
  readonly modules?: ModModuleCatalog;
  readonly initialServices?: Readonly<Record<string, unknown>>;
}

interface RegisteredHook {
  readonly modId: string;
  readonly handler: FullTrustModHook;
}

interface PropertySeamLedger {
  readonly label: string;
  /** The descriptor as it stood before any mod touched this member. */
  readonly original: PropertyDescriptor | undefined;
  readonly claims: ModSeamClaim[];
  base?: { value: (...args: unknown[]) => unknown } | undefined;
  hasBaseInterceptors?: boolean;
}

interface ModFileAccess {
  list(): readonly string[];
  has(path: string): boolean;
  bytes(path: string): Uint8Array;
  text(path: string): string;
  json<T = unknown>(path: string): T;
  url(path: string, mediaType?: string): string;
  run(path: string): Promise<unknown>;
}

interface FullTrustModApi {
  readonly manifest: CodeModManifestV4;
  /** Every selected package in resolved activation order, so a mod can see who else is present. */
  readonly loadOrder: readonly ModProfileEntry[];
  readonly files: ModFileAccess;
  readonly modules: ModModuleCatalog;
  readonly host: ModHostRegistry;
  readonly exports: Record<string, unknown>;
  readonly hooks: {
    on(name: string, handler: FullTrustModHook): () => void;
  };
  replace(target: object, key: PropertyKey, value: unknown): () => void;
  intercept(
    target: object,
    key: PropertyKey,
    wrapper: (this: unknown, next: (...args: unknown[]) => unknown, ...args: unknown[]) => unknown,
  ): () => void;
  original<T = unknown>(target: object, key: PropertyKey): T;
  /** Compose inside existing interceptors without discarding their setup/cleanup. */
  interceptBase: FullTrustModApi["intercept"];
  merge<T>(base: T, patch: unknown): T;
  interference(): ModInterferenceReport;
  onDispose(dispose: () => void): () => void;
}

type AsyncFunctionConstructor = new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as AsyncFunctionConstructor;

// Replacement values returned from a phase are diffed against what the mod received so overlapping
// data edits are attributable. Reference-identical subtrees prune, which is why the ordinary
// spread-clone authoring style costs almost nothing to audit.
const MAX_DIFF_PATHS = 256;
const MAX_DIFF_DEPTH = 12;
const MAX_DIFF_NODES = 200_000;

/**
 * Activates user-selected code in the application realm. This deliberately provides no sandbox,
 * permission broker, timeout, or value membrane: a mod can reach the DOM, storage, network APIs,
 * imported game modules, and every live object the host publishes.
 */
export async function createFullTrustCodeModRuntime(
  profile: ResolvedCodeModProfile,
  options: FullTrustModRuntimeOptions = {},
): Promise<FullTrustModRuntime> {
  const modules = options.modules ?? fullTrustModModules;
  const services = new Map<string, unknown>(Object.entries(options.initialServices ?? {}));
  const hooks = new Map<string, RegisteredHook[]>();
  const disposers: Array<() => void> = [];
  const objectUrls = new Set<string>();
  const propertySeams = new WeakMap<object, Map<PropertyKey, PropertySeamLedger>>();
  const propertyLedgers: PropertySeamLedger[] = [];
  const serviceSeams = new Map<string, ModSeamClaim[]>();
  const dataSeams = new Map<string, ModSeamClaim[]>();
  const order: readonly ModProfileEntry[] = Object.freeze(profile.packages.map((pkg) =>
    Object.freeze({
      id: pkg.manifest.id,
      version: pkg.manifest.version,
      displayName: pkg.manifest.displayName,
      priority: pkg.manifest.priority,
    }),
  ));
  let disposed = false;
  /** Whose `host.set` calls are being attributed; undefined while the host itself is writing. */
  let activeModId: string | undefined;

  const host: ModHostRegistry = {
    list: () => Object.freeze([...services.keys()].sort(compareText)),
    has: (name) => services.has(name),
    get: <T>(name: string): T | undefined => services.get(name) as T | undefined,
    require: <T>(name: string): T => {
      if (!services.has(name)) throw new Error(`Mod host service ${JSON.stringify(name)} is unavailable`);
      return services.get(name) as T;
    },
    set: (name, value) => {
      if (name.length === 0) throw new Error("Mod host service name must not be empty");
      // `mods.<id>` is namespaced by construction and every phase name is host-owned, so only
      // mod-invented service names can actually be contested.
      if (activeModId !== undefined && !name.startsWith("mods.")) {
        claim(serviceSeams, `host:${name}`, { modId: activeModId, action: "set" });
      }
      services.set(name, value);
    },
    delete: (name) => services.delete(name),
  };

  const interference = (): ModInterferenceReport => {
    const seams: ModSeam[] = [];
    for (const ledger of propertyLedgers) seams.push(...contestedPropertySeam(ledger));
    for (const [target, claims] of serviceSeams) {
      seams.push(...contestedSeam("service", target, claims, (winner) =>
        `${winner} owns this service name; earlier mods that set it are unreachable`));
    }
    for (const [target, claims] of dataSeams) {
      seams.push(...contestedSeam("data", target, claims, (winner) =>
        `${winner} wrote this path last, so its value is the one the game loads`));
    }
    seams.sort((left, right) =>
      severityRank(right) - severityRank(left) || compareText(left.target, right.target));
    return Object.freeze({
      order,
      seams: Object.freeze(seams),
      warnings: Object.freeze(seams.filter((seam) => seam.severity === "warning")),
    });
  };

  const runPhase = async <T>(name: string, initialValue: T): Promise<T> => {
    if (disposed) throw new Error("Mod runtime is disposed");
    let value = initialValue;
    for (const registered of [...(hooks.get(name) ?? [])]) {
      const event: FullTrustModPhase<T> = { name, modId: registered.modId, value, host };
      const previous = activeModId;
      activeModId = registered.modId;
      let returned: void | T;
      try {
        returned = await registered.handler(event) as void | T;
      } finally {
        activeModId = previous;
      }
      const next = returned === undefined ? event.value : returned;
      for (const path of changedPaths(value, next)) {
        claim(dataSeams, `${name} → ${path}`, { modId: registered.modId, action: "write" });
      }
      value = next;
    }
    services.set(name, value);
    return value;
  };

  const execute = async (pkg: CodeModPackage, api: FullTrustModApi, path: string): Promise<unknown> => {
    if (disposed) throw new Error("Mod runtime is disposed");
    const bytes = pkg.files.get(path);
    if (bytes === undefined) throw new Error(`${pkg.manifest.id}: missing bundle file ${path}`);
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new Error(`${pkg.manifest.id}: ${path} is not UTF-8: ${describeError(error)}`);
    }
    const sourceLabel = `${pkg.archiveName}:${path}`.replace(/[\r\n]/g, "_");
    const run = new AsyncFunction(
      "dibMod",
      `"use strict";\n${source}\n//# sourceURL=${sourceLabel}`,
    );
    const previous = activeModId;
    activeModId = pkg.manifest.id;
    try {
      return await run(api);
    } finally {
      activeModId = previous;
    }
  };

  try {
    for (const pkg of profile.packages) {
      const modId = pkg.manifest.id;
      const modDisposers: Array<() => void> = [];
      const urls = new Map<string, string>();
      const exported: Record<string, unknown> = {};
      const api = {} as FullTrustModApi;
      const files: ModFileAccess = {
        list: () => Object.freeze([...pkg.files.keys()].sort(compareText)),
        has: (path) => pkg.files.has(path),
        bytes: (path) => requiredFile(pkg, path).slice(),
        text: (path) => new TextDecoder("utf-8", { fatal: true }).decode(requiredFile(pkg, path)),
        json: <T>(path: string): T => JSON.parse(files.text(path)) as T,
        url: (path, mediaType) => {
          const key = `${path}\0${mediaType ?? ""}`;
          const previous = urls.get(key);
          if (previous !== undefined) return previous;
          const bytes = requiredFile(pkg, path).slice();
          const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], {
            type: mediaType ?? mediaTypeFor(path),
          }));
          urls.set(key, url);
          objectUrls.add(url);
          return url;
        },
        run: async (path) => await execute(pkg, api, path),
      };

      /** Installs a value over `key`, recording who claimed the seam and what they did to it. */
      const install = (
        target: object,
        key: PropertyKey,
        value: unknown,
        action: "replace" | "intercept",
      ): (() => void) => {
        const own = Object.getOwnPropertyDescriptor(target, key);
        let members = propertySeams.get(target);
        if (members === undefined) {
          members = new Map();
          propertySeams.set(target, members);
        }
        let ledger = members.get(key);
        if (ledger === undefined) {
          ledger = { label: describeMember(target, key), original: own, claims: [] };
          members.set(key, ledger);
          propertyLedgers.push(ledger);
        }
        const previousBase = ledger.base;
        if (action === "replace") ledger.base = undefined;
        ledger.claims.push({ modId, action });
        Object.defineProperty(target, key, {
          configurable: true,
          enumerable: own?.enumerable ?? true,
          writable: true,
          value,
        });
        const restore = once(() => {
          ledger!.base = previousBase;
          if (own === undefined) delete (target as Record<PropertyKey, unknown>)[key];
          else Object.defineProperty(target, key, own);
        });
        modDisposers.push(restore);
        return restore;
      };

      Object.assign(api, {
        manifest: pkg.manifest,
        loadOrder: order,
        files,
        modules,
        host,
        exports: exported,
        hooks: {
          on: (name: string, handler: FullTrustModHook): (() => void) => {
            if (name.length === 0 || typeof handler !== "function") {
              throw new Error(`${modId}: invalid lifecycle hook registration`);
            }
            const registered: RegisteredHook = { modId, handler };
            const list = hooks.get(name) ?? [];
            list.push(registered);
            hooks.set(name, list);
            const remove = (): void => {
              const current = hooks.get(name);
              if (current === undefined) return;
              const index = current.indexOf(registered);
              if (index >= 0) current.splice(index, 1);
              if (current.length === 0) hooks.delete(name);
            };
            modDisposers.push(remove);
            return remove;
          },
        },
        replace: (target: object, key: PropertyKey, value: unknown): (() => void) =>
          install(target, key, value, "replace"),
        intercept: (
          target: object,
          key: PropertyKey,
          wrapper: FullTrustModApi["intercept"] extends (
            target: object,
            key: PropertyKey,
            wrapper: infer W,
          ) => unknown ? W : never,
        ): (() => void) => {
          if (typeof wrapper !== "function") throw new Error(`${String(key)} interceptor must be a function`);
          const original = (target as Record<PropertyKey, unknown>)[key];
          if (typeof original !== "function") throw new Error(`${String(key)} is not a function`);
          const priorBase = propertySeams.get(target)?.get(key)?.base;
          const base = priorBase ?? { value: original as (...args: unknown[]) => unknown };
          const intercepted = function (this: unknown, ...args: unknown[]): unknown {
            const next = (...nextArgs: unknown[]) => (priorBase === undefined ? base.value : original)
              .apply(this, nextArgs);
            return wrapper.call(this, next, ...args);
          };
          const restore = install(target, key, intercepted, "intercept");
          propertySeams.get(target)!.get(key)!.base = base;
          return restore;
        },
        interceptBase: (target, key, wrapper) => {
          if (typeof wrapper !== "function") throw new Error(`${String(key)} interceptor must be a function`);
          // Establish a dispatch point even if this is the first interceptor on the member.
          if (propertySeams.get(target)?.get(key)?.base === undefined) {
            api.intercept(target, key, function (next, ...args) { return next(...args); });
          }
          const ledger = propertySeams.get(target)!.get(key)!;
          ledger.hasBaseInterceptors = true;
          const base = ledger.base!;
          const previous = base.value;
          base.value = function (this: unknown, ...args: unknown[]) {
            return wrapper.call(this, (...nextArgs) => previous.apply(this, nextArgs), ...args);
          };
          ledger.claims.push({ modId, action: "intercept" });
          const restore = once(() => { base.value = previous; });
          modDisposers.push(restore);
          return restore;
        },
        original: <T>(target: object, key: PropertyKey): T => {
          const ledger = propertySeams.get(target)?.get(key);
          if (ledger === undefined) return (target as Record<PropertyKey, unknown>)[key] as T;
          const { original } = ledger;
          if (original === undefined) return undefined as T;
          return (original.get === undefined
            ? original.value
            : original.get.call(target)) as T;
        },
        merge: <T>(base: T, patch: unknown): T => deepMerge(base, patch) as T,
        interference,
        onDispose: (dispose: () => void): (() => void) => {
          if (typeof dispose !== "function") throw new Error("onDispose requires a function");
          const registered = once(dispose);
          modDisposers.push(registered);
          return registered;
        },
      } satisfies FullTrustModApi);

      services.set(`mods.${modId}`, exported);
      disposers.push(() => {
        for (const dispose of [...modDisposers].reverse()) dispose();
        services.delete(`mods.${modId}`);
      });
      await execute(pkg, api, pkg.manifest.entry);
    }
    // Every entry has run, so a compatibility patch can now see the whole profile, read the
    // interference report, and register phase handlers that land after everyone else's.
    await runPhase("mods:ready", interference());
  } catch (error) {
    for (const dispose of [...disposers].reverse()) dispose();
    for (const url of objectUrls) URL.revokeObjectURL(url);
    throw error;
  }

  const runtime: FullTrustModRuntime = {
    profile,
    host,
    runPhase,
    interference,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const dispose of [...disposers].reverse()) {
        try { dispose(); } catch (error) { console.error("Mod dispose failed", error); }
      }
      hooks.clear();
      services.clear();
      for (const url of objectUrls) URL.revokeObjectURL(url);
      objectUrls.clear();
    },
  };
  return runtime;
}

function claim(seams: Map<string, ModSeamClaim[]>, target: string, entry: ModSeamClaim): void {
  const claims = seams.get(target);
  if (claims === undefined) seams.set(target, [entry]);
  else claims.push(entry);
}

function contestedSeam(
  kind: ModSeamKind,
  target: string,
  claims: readonly ModSeamClaim[],
  summarize: (winner: string) => string,
): ModSeam[] {
  if (new Set(claims.map((entry) => entry.modId)).size < 2) return [];
  return [Object.freeze({
    kind,
    target,
    claims: Object.freeze([...claims]),
    severity: "warning",
    summary: summarize(claims.at(-1)!.modId),
  })];
}

function contestedPropertySeam(ledger: PropertySeamLedger): ModSeam[] {
  const { claims } = ledger;
  if (new Set(claims.map((entry) => entry.modId)).size < 2) return [];
  // Interceptors nest, so every one of them still runs; a plain replace drops whatever the mods
  // before it installed. That distinction is the whole difference between overlap and breakage.
  const discarding = claims.findIndex((entry, index) =>
    index > 0 && entry.action === "replace" && entry.modId !== claims[index - 1]!.modId);
  const outermost = claims.at(-1)!.modId;
  return [Object.freeze({
    kind: "property" as const,
    target: ledger.label,
    claims: Object.freeze([...claims]),
    severity: discarding >= 0 ? "warning" as const : "info" as const,
    summary: discarding >= 0
      ? `${claims[discarding]!.modId} replaces this member outright, discarding ` +
        `${[...new Set(claims.slice(0, discarding).map((entry) => entry.modId))].join(", ")}`
      : ledger.hasBaseInterceptors
      ? `${claims.length} method hooks compose, including innermost hooks beneath the outer interceptor chain`
      : `${claims.length} interceptors compose; ${outermost} runs first and decides whether the ` +
        "rest are reached",
  })];
}

function severityRank(seam: ModSeam): number {
  return seam.severity === "warning" ? 1 : 0;
}

/** `BattleNode.prototype.sleep`, `StoreFlow.show`, or a plain object's `name#key`. */
function describeMember(target: object, key: PropertyKey): string {
  const name = String(typeof key === "symbol" ? key.description ?? "symbol" : key);
  if (typeof target === "function") {
    return `${(target as { name?: string }).name || "anonymous"}.${name}`;
  }
  const constructor = Object.hasOwn(target, "constructor")
    ? (target as { constructor?: unknown }).constructor
    : undefined;
  if (typeof constructor === "function" && (constructor as { prototype?: unknown }).prototype === target) {
    return `${constructor.name || "anonymous"}.prototype.${name}`;
  }
  const owner = (target as { constructor?: { name?: string } }).constructor?.name;
  return `${owner === undefined || owner === "Object" ? "object" : owner}#${name}`;
}

/**
 * Dotted paths whose value a phase handler changed. Only returned replacements are visible here:
 * a mod that mutates a live object in place leaves the two references identical and is invisible
 * to the diff by construction.
 */
function changedPaths(before: unknown, after: unknown): readonly string[] {
  if (Object.is(before, after)) return [];
  const found: string[] = [];
  walkChanges(before, after, "", found, { nodes: MAX_DIFF_NODES }, 0, new Set());
  return found;
}

function walkChanges(
  before: unknown,
  after: unknown,
  path: string,
  found: string[],
  budget: { nodes: number },
  depth: number,
  ancestors: Set<object>,
): void {
  if (Object.is(before, after) || found.length >= MAX_DIFF_PATHS) return;
  const label = path.length === 0 ? "(root)" : path;
  budget.nodes -= 1;
  if (budget.nodes <= 0 || depth >= MAX_DIFF_DEPTH || Array.isArray(before) !== Array.isArray(after) ||
      !isPlainContainer(before) || !isPlainContainer(after) || ancestors.has(after)) {
    found.push(label);
    return;
  }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(compareText);
  // Two structurally empty containers differ only by identity, which no consumer can observe.
  if (keys.length === 0) return;
  ancestors.add(after);
  for (const key of keys) {
    walkChanges(
      (before as Record<string, unknown>)[key],
      (after as Record<string, unknown>)[key],
      path.length === 0 ? key : `${path}.${key}`,
      found,
      budget,
      depth + 1,
      ancestors,
    );
    if (found.length >= MAX_DIFF_PATHS) break;
  }
  ancestors.delete(after);
}

/** Arrays and object-literal shapes recurse; class instances, Maps, and buffers are leaves. */
function isPlainContainer(value: unknown): value is object {
  if (Array.isArray(value)) return true;
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Composes a patch into a base without discarding sibling keys another mod already added. */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainContainer(base) || !isPlainContainer(patch)) return patch;
  if (Array.isArray(base) || Array.isArray(patch)) return patch;
  const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    merged[key] = value === undefined ? undefined : deepMerge(merged[key], value);
  }
  return merged;
}

function requiredFile(pkg: CodeModPackage, path: string): Uint8Array {
  const bytes = pkg.files.get(path);
  if (bytes === undefined) throw new Error(`${pkg.manifest.id}: missing bundle file ${path}`);
  return bytes;
}

function mediaTypeFor(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return ({
    css: "text/css",
    html: "text/html",
    js: "text/javascript",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    svg: "image/svg+xml",
    wav: "audio/wav",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    ttf: "font/ttf",
    otf: "font/otf",
  } as Record<string, string>)[extension] ?? "application/octet-stream";
}

function once(dispose: () => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    dispose();
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
