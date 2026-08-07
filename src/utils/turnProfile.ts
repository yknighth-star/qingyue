import type { DeviceClass, PageTurnMode } from '@/types'
import { DUAL_COLUMN_MIN_WIDTH } from '@/utils/format'

/** Page-turn animation budget for the current form factor × pointer. */
export type TurnAnimKind = 'full-curl' | 'lite-curl' | 'slide'

export interface TurnProfile {
  device: DeviceClass
  fine: boolean
  coarse: boolean
  hover: boolean
  dualEligible: boolean
  /** May transform live surface for curl drag preview (never EPUB). */
  liveCurlPreview: boolean
  /** Effective animation when settings.pageTurn === 'curl'. */
  curlAnim: TurnAnimKind
  /** Edge tap zone width as fraction of stage (0–1). */
  edgeWidth: number
  /** Horizontal swipe distance threshold factor (of stage width). */
  swipeWidthFactor: number
  /** Minimum swipe px (before width factor). */
  swipeMinPx: number
}

function readPointerFlags() {
  if (typeof window === 'undefined') {
    return { fine: true, coarse: false, hover: true }
  }
  return {
    fine: window.matchMedia('(pointer: fine)').matches,
    coarse: window.matchMedia('(pointer: coarse)').matches,
    hover: window.matchMedia('(hover: hover)').matches,
  }
}

function isLowPowerDevice() {
  if (typeof navigator === 'undefined') return false
  const cores = navigator.hardwareConcurrency || 8
  return cores <= 4
}

/**
 * Build turn/gesture profile from viewport + pointer.
 * Form factor (width) and pointer modality are orthogonal — tablets are often mid-width + coarse.
 */
export function resolveTurnProfile(width = typeof window !== 'undefined' ? window.innerWidth : 1200): TurnProfile {
  const deviceFromWidth: DeviceClass =
    width < 768 ? 'phone' : width < DUAL_COLUMN_MIN_WIDTH ? 'tablet' : 'desktop'
  const { fine, coarse, hover } = readPointerFlags()
  const dualEligible = width >= DUAL_COLUMN_MIN_WIDTH
  const lowPower = isLowPowerDevice()

  let curlAnim: TurnAnimKind = 'full-curl'
  if (deviceFromWidth === 'phone' || (coarse && !fine) || lowPower) {
    curlAnim = 'lite-curl'
  } else if (deviceFromWidth === 'tablet' && (coarse || lowPower)) {
    curlAnim = 'lite-curl'
  }

  // Live curl preview only when fine pointer can drag precisely; never rely on it for coarse-only.
  const liveCurlPreview = fine && curlAnim === 'full-curl'

  let edgeWidth = 0.11
  if (deviceFromWidth === 'tablet') edgeWidth = 0.13
  if (deviceFromWidth === 'desktop' && fine) edgeWidth = 0.09

  let swipeWidthFactor = 0.18
  let swipeMinPx = 48
  if (deviceFromWidth === 'phone') {
    swipeWidthFactor = 0.14
    swipeMinPx = 40
  } else if (deviceFromWidth === 'tablet') {
    swipeWidthFactor = 0.16
    swipeMinPx = 44
  }

  return {
    device: deviceFromWidth,
    fine,
    coarse,
    hover,
    dualEligible,
    liveCurlPreview,
    curlAnim,
    edgeWidth,
    swipeWidthFactor,
    swipeMinPx,
  }
}

/** Resolve gate animation for a pageTurn setting + profile. */
export function resolveTurnAnim(pageTurn: PageTurnMode, profile: TurnProfile): 'none' | 'slide' | 'curl' | 'lite-curl' {
  if (pageTurn === 'scroll') return 'none'
  if (pageTurn === 'slide') return 'slide'
  return profile.curlAnim === 'lite-curl' ? 'lite-curl' : 'curl'
}

export function turnProfileDataset(profile: TurnProfile): Record<string, string> {
  return {
    device: profile.device,
    anim: profile.curlAnim,
    pointer: profile.fine ? 'fine' : 'coarse',
  }
}
