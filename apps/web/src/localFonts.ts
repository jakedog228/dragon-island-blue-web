import markerFeltUrl from "./assets/fonts/MarkerFelt.ttf";

export const MARKER_FELT_FAMILY = "Marker Felt";

export type MarkerFeltStatus = "loaded" | "fallback";


export async function loadRequiredLocalFonts(): Promise<MarkerFeltStatus> {
  if (typeof document === "undefined" || !("fonts" in document)) return "loaded";
  try {


    const source = `local("Marker Felt"), url(${JSON.stringify(markerFeltUrl)})`;
    const face = new FontFace(MARKER_FELT_FAMILY, source, { weight: "normal" });
    await face.load();
    document.fonts.add(face);
    return "loaded";
  } catch {
    console.warn(
      '[localFonts] "Marker Felt" could not be loaded; evolve-chain rows will use the browser fallback.',
    );
    return "fallback";
  }
}
