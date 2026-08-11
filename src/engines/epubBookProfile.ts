/**
 * Book-level reading profile for EPUB.
 * - 诡秘之主-class: huge spine, almost no images → textNovel
 * - 明朝那些事儿-class: huge spine + many images → illustratedLarge
 * Both need cheap turns; illustratedLarge still needs eventual contrast washes.
 */

export interface EpubBookProfile {
  spineLength: number
  imageAssetCount: number
  fileBytes: number
  /** Many spine chapters — never run whole-book locations.generate. */
  largeSpine: boolean
  /** Text-heavy web novel: skip publisher washes / scripts / heavy theme thrash. */
  textNovel: boolean
  /** Large spine + many images (e.g. 明朝那些事儿图文版). */
  illustratedLarge: boolean
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
  const illustratedLarge = largeSpine && !textNovel

  return {
    spineLength,
    imageAssetCount,
    fileBytes,
    largeSpine,
    textNovel,
    illustratedLarge,
  }
}
