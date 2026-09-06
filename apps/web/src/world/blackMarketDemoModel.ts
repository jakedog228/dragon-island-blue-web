/**
 * PORT ADAPTATION / DEMO CONTENT.
 *
 * These cards are app-owned presentation data. They are intentionally not a
 * reconstruction of the retired Black Market service and are not read from a
 * content package.
 */
export interface BlackMarketDemoCard {
  readonly id: "preservation" | "community";
  readonly title: string;
  readonly body: string;
  readonly imageUrl: string;
  readonly destinationUrl: "https://example.com/" | "https://example.org/";
}

/**
 * Presentation-only seam for Task 2. The asset type is generic so this model
 * does not depend on Pixi (or on a browser image type), and each request can
 * be cancelled by its owner during modal disposal.
 *
 * The loader owns the loaded result. Its release callback is the only legal
 * way for the consumer to release it: an app-owned loader may destroy a
 * texture it created, while an archive/shared-texture loader may make release
 * a no-op. The flow calls release exactly once for every accepted or late
 * result and never calls `destroy` on the image itself.
 */
export interface DemoImageLoadHandle {
  cancel(): void;
}

export interface DemoImageLoadResult<TImage = unknown> {
  readonly image: TImage;
  readonly release: () => void;
}

export interface DemoImageLoader<TImage = unknown> {
  load(
    imageUrl: BlackMarketDemoCard["imageUrl"],
    onLoad: (result: DemoImageLoadResult<TImage>) => void,
    onError: (error: unknown) => void,
  ): DemoImageLoadHandle;
}

const PRESERVATION_IMAGE_URL =
  "https://placehold.co/640x360/png?text=Preservation+Demo";
const COMMUNITY_IMAGE_URL =
  "https://placehold.co/640x360/png?text=Community+Demo";

const PRESERVATION_DESTINATION_URL = "https://example.com/";
const COMMUNITY_DESTINATION_URL = "https://example.org/";

const cards = [
  Object.freeze({
    id: "preservation" as const,
    title: "Preservation Demo",
    body: "DEMO CONTENT: the historical online service is unavailable.",
    imageUrl: PRESERVATION_IMAGE_URL,
    destinationUrl: PRESERVATION_DESTINATION_URL,
  }),
  Object.freeze({
    id: "community" as const,
    title: "Community Demo",
    body: "DEMO CONTENT: this presentation-only card has no gameplay effect.",
    imageUrl: COMMUNITY_IMAGE_URL,
    destinationUrl: COMMUNITY_DESTINATION_URL,
  }),
] satisfies readonly BlackMarketDemoCard[];

/** App-owned fixed catalog; no package or authored URL input is accepted. */
export const BLACK_MARKET_DEMO_CARDS: readonly BlackMarketDemoCard[] =
  Object.freeze(cards);

function cardForId(cardId: BlackMarketDemoCard["id"]): BlackMarketDemoCard {
  const card = BLACK_MARKET_DEMO_CARDS.find((candidate) => candidate.id === cardId);
  if (card === undefined) {
    throw new Error(`unknown Black Market demo card: ${String(cardId)}`);
  }
  return card;
}

export interface ExternalPageOpener {
  open(
    url: BlackMarketDemoCard["destinationUrl"],
    target: "_blank",
    features: "noopener,noreferrer",
  ): void;
}

export function openBlackMarketDemoCard(
  cardId: BlackMarketDemoCard["id"],
  opener: ExternalPageOpener,
): void {
  const card = cardForId(cardId);
  opener.open(card.destinationUrl, "_blank", "noopener,noreferrer");
}
