/**
 * Web Mercator ground resolution, and the projection onto a fixed-size image.
 *
 * Its own module because BOTH the roof designer and the customer-facing
 * proposal draw the same array on the same imagery, and they are in different
 * bundles. Two copies of this arithmetic would be two arrays that disagree
 * about where the panels are — one of them shown to a rep and the other to the
 * homeowner.
 */

/** Metres per pixel at a latitude and zoom. `scale: 2` is a HiDPI image. */
export function metresPerPixel(lat: number, zoom: number, scale: 1 | 2 = 1): number {
  return (156543.03392804097 * Math.cos((lat * Math.PI) / 180)) / (2 ** zoom * scale);
}

/**
 * The zoom at which a given ground resolution is served.
 *
 * The inverse of `metresPerPixel`, used to frame an array: work out the metres
 * per pixel that fits it, then ask what zoom that is. Returned unrounded — the
 * caller decides whether to floor it (framing, where erring wider keeps the
 * whole array on the picture) or round it.
 */
export function zoomForMetresPerPixel(lat: number, mpp: number, scale: 1 | 2 = 1): number {
  if (!(mpp > 0)) return 20;
  return Math.log2((156543.03392804097 * Math.cos((lat * Math.PI) / 180)) / (mpp * scale));
}

/**
 * Ground metres → pixel on a static map centred on the deal.
 *
 * Takes both dimensions rather than one "size": the imagery route serves
 * 1280x720, and halving the wrong edge puts the whole array off the roof.
 */
export function metresToImagePx(
  e: number,
  n: number,
  mpp: number,
  image: { widthPx: number; heightPx: number }
): { x: number; y: number } {
  // Mercator's cos(lat) stretch is already in `mpp`, and a residential roof
  // spans tens of metres, so treating north as a straight vertical here is
  // accurate to well under a pixel.
  return { x: image.widthPx / 2 + e / mpp, y: image.heightPx / 2 - n / mpp };
}
