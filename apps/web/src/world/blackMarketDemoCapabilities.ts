import { Texture } from "pixi.js";
import {
  BLACK_MARKET_DEMO_CARDS,
  type DemoImageLoadHandle,
  type DemoImageLoader,
  type DemoImageLoadResult,
  type ExternalPageOpener,
} from "./blackMarketDemoModel.js";

const DEMO_IMAGE_URLS = new Set(BLACK_MARKET_DEMO_CARDS.map(({ imageUrl }) => imageUrl));
const DEMO_DESTINATION_URLS = new Set(
  BLACK_MARKET_DEMO_CARDS.map(({ destinationUrl }) => destinationUrl),
);

/**
 * App-shell implementation of the closed demo navigation seam.
 *
 * The opener controls only this initial new-tab request. Once the reserved site owns that tab,
 * later navigation and redirects are outside the port's control boundary.
 */
export function createBlackMarketDemoExternalPageOpener(): ExternalPageOpener {
  return {
    open(url, target, features): void {
      if (!DEMO_DESTINATION_URLS.has(url)) {
        throw new Error(`unknown Black Market destination: ${String(url)}`);
      }
      if (target !== "_blank" || features !== "noopener,noreferrer") {
        throw new Error("Black Market destination must use _blank with noopener,noreferrer");
      }
      window.open(url, target, features);
    },
  };
}

/** App-shell image capability for the two fixed demo request URLs only. */
export function createBlackMarketDemoImageLoader(): DemoImageLoader<Texture> {
  return {
    load(imageUrl, onLoad, onError): DemoImageLoadHandle {
      if (!DEMO_IMAGE_URLS.has(imageUrl)) {
        throw new Error(`unknown Black Market image URL: ${String(imageUrl)}`);
      }

      const image = new Image();
      image.crossOrigin = "anonymous";
      let active = true;
      let settled = false;
      let texture: Texture | undefined;

      const removeListeners = (): void => {
        image.removeEventListener("load", handleLoad);
        image.removeEventListener("error", handleError);
      };
      const handleLoad = (): void => {
        if (!active || settled) return;
        settled = true;
        active = false;
        removeListeners();
        try {
          texture = Texture.from(image);
        } catch (error) {
          onError(error);
          return;
        }
        let released = false;
        const result: DemoImageLoadResult<Texture> = {
          image: texture,
          release: (): void => {
            if (released) return;
            released = true;
            texture!.destroy(true);
          },
        };
        onLoad(result);
      };
      const handleError = (event: Event): void => {
        if (!active || settled) return;
        settled = true;
        active = false;
        removeListeners();
        onError(event);
      };
      image.addEventListener("load", handleLoad);
      image.addEventListener("error", handleError);
      image.src = imageUrl;

      return {
        cancel: (): void => {
          if (!active || settled) return;
          active = false;
          settled = true;
          removeListeners();
        },
      };
    },
  };
}
