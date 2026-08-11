/**
 * Book-level reading profile for EPUB.
 * Large CN web-novel packages (e.g. 诡秘之主) have hundreds/thousands of spine
 * items and almost no images — they need a different cost model than illustrated books.
 */

export interface EpubBookProfile {
  spineLength: number
  imageAssetCount: number
  fileBytes: number
  /** Many spine chapters — never run whole-book locations.generate. */
  largeSpine: boolean
  /** Text-heavy web novel: skip publisher washes / scripts / heavy theme thrash. */
  textNovel: boolean
}

type ResourcesLike = {
  urls?: string[]
  cssUrls?: string[]
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp)($|\?)/i

/** Spine chapters above this: locations.generate is banned (UI-thread killer). */
export const LARGE_SPINE_THRESHOLD = 60

export function detectEpubBookProfile(
  spineLength: number,
  fileBytes: number,
  resources?: ResourcesLike | null,
): EpubBookProfile {
  const urls = resources?.urls || []
  const imageAssetCount = urls.filter((u) => IMAGE_RE.test(u)).length
  const largeSpine = spineLength >= LARGE_SPINE_THRESHOLD
  // Web-novel shaped: long spine, few images, not a gigantic comic archive.
  const textNovel =
    largeSpine && imageAssetCount <= 48 && (fileBytes <= 0 || fileBytes < 120 * 1024 * 1024)

  return {
    spineLength,
    imageAssetCount,
    fileBytes,
    largeSpine,
    textNovel,
  }
}
