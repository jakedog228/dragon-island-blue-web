/** Strict source `Chats.plist` projection shared by story, quest, and encounter flows. */

export interface ChatResourceSource {
  has(path: string): boolean;
  plist(path: string): unknown;
}

export interface ChatDefinition {
  readonly name: string;
  /** Native omitted default. Only explicitly-false chats are suppressed after first display. */
  readonly alwaysShow: boolean;
  /** Authored entries use one portrait; a missing catalog entry follows native nil messaging. */
  readonly imageFile?: string;
  /** Optional explicit localization keys; absent/empty falls back to `${name}ChatKey`. */
  readonly messageKeys: readonly string[];
}

export class ChatDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatDataError";
  }
}

export function loadChatDefinition(
  source: ChatResourceSource,
  name: string,
): ChatDefinition {
  expect(name.length > 0, "chat name must not be empty");
  expect(source.has("Chats.plist"), `Chat ${name} requires Chats.plist.`);
  const catalog = dict(source.plist("Chats.plist"), "Chats.plist");
  if (catalog[name] === undefined) {
    // Objective-C dictionary messaging sends `messages`, `images`, and `alwaysShow` to nil.
    // The text path therefore uses `${name}ChatKey`, shows no portrait, and retains the true
    // default for `alwaysShow` (the shipped ShenronDefeated event exercises this branch).
    return Object.freeze({
      name,
      alwaysShow: true,
      messageKeys: Object.freeze([]),
    });
  }
  const raw = dict(catalog[name], `Chats.plist.${name}`);
  exactKeys(raw, new Set(["alwaysShow", "images", "messages"]), `Chats.plist.${name}`);
  const images = array(raw.images, `Chats.plist.${name}.images`);
  expect(images.length === 1, `Chats.plist.${name}.images must contain exactly one portrait.`);
  const imageFile = png(images[0], `Chats.plist.${name}.images[0]`);
  const messageKeys = raw.messages === undefined
    ? []
    : array(raw.messages, `Chats.plist.${name}.messages`).map((value, index) =>
        nonemptyString(value, `Chats.plist.${name}.messages[${index}]`));
  return Object.freeze({
    name,
    alwaysShow: raw.alwaysShow === undefined
      ? true
      : boolean(raw.alwaysShow, `Chats.plist.${name}.alwaysShow`),
    imageFile,
    messageKeys: Object.freeze(messageKeys),
  });
}

function nonemptyString(value: unknown, path: string): string {
  expect(typeof value === "string" && value.length > 0, `${path} must be a non-empty string.`);
  return value;
}

function dict(value: unknown, path: string): Record<string, unknown> {
  expect(
    typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      !(value instanceof Uint8Array),
    `${path} must be a dictionary.`,
  );
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  expect(Array.isArray(value), `${path} must be an array.`);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  expect(typeof value === "boolean", `${path} must be boolean.`);
  return value;
}

function png(value: unknown, path: string): string {
  expect(
    typeof value === "string" &&
      value.length > 0 &&
      !value.includes("/") &&
      !value.includes("\\") &&
      value.toLowerCase().endsWith(".png"),
    `${path} must be a root-level PNG resource.`,
  );
  return value;
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(value)) {
    expect(allowed.has(key), `${path} contains unsupported key ${key}.`);
  }
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ChatDataError(message);
}
