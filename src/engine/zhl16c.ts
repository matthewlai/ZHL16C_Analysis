import {
  ALVEOLAR_WATER_VAPOR_PRESSURE_BAR,
  STANDARD_AIR_FN2,
  SURFACE_PRESSURE_STANDARD_BAR,
  WATER_DENSITY_PRESETS,
  getCompartments,
} from './constants'
import type { CompartmentCoefficients, Zhl16Variant } from './constants'

const LN2 = Math.LN2
const EPSILON = 1e-9
const MAX_STOP_MINUTES = 2000

export type GfAnchorMode = 'first_stop' | 'continuous_ceiling'

export type SegmentType = 'descent' | 'bottom' | 'ascent' | 'deco_stop'

export interface DiveSegment {
  readonly type: SegmentType
  readonly startTimeMinutes: number
  readonly endTimeMinutes: number
  readonly durationMinutes: number
  readonly startDepthMeters: number
  readonly endDepthMeters: number
}

export interface DecoStop {
  /** Stop depth in meters */
  readonly depthMeters: number
  /** Mandatory hold duration at this stop in whole minutes */
  readonly durationMinutes: number
  /** Runtime when arriving at this stop (min) */
  readonly arrivalRuntimeMinutes: number
  /** Runtime when leaving this stop (min) */
  readonly departureRuntimeMinutes: number
  /** Target next depth (m) cleared upon leaving this stop */
  readonly nextDepthMeters: number
  /** Active GF fraction (0..1) evaluated at nextDepthMeters */
  readonly targetGf: number
  /** 1-based compartment index (1..16) controlling departure from this stop */
  readonly leadingCompartment: number
}

export interface ProfileSample {
  /** Runtime in minutes */
  readonly timeMinutes: number
  /** Diver depth in meters */
  readonly depthMeters: number
  /** Ambient absolute pressure in bar */
  readonly ambientPressureBar: number
  /** Active GF-ramped decompression ceiling depth in meters (>= 0) */
  readonly ceilingDepthMeters: number
  /** Raw GF Low ceiling depth in meters (>= 0) */
  readonly gfLowCeilingMeters: number
  /** Raw GF High ceiling depth in meters (>= 0) */
  readonly gfHighCeilingMeters: number
  /** 1-based leading compartment index (1..16) */
  readonly leadingCompartment: number
  /** Instantaneous leading compartment GF at current ambient pressure (0..1+, e.g. 0.82 = 82%) */
  readonly gf99: number
  /** N2 tensions across all 16 compartments (bar) */
  readonly compartmentN2Bar: readonly number[]
}

export interface DivePlanInput {
  /** Target bottom depth in meters (> 0) */
  readonly depthMeters: number
  /** Total bottom time in minutes (from start of descent at t=0 until start of ascent) */
  readonly bottomTimeMinutes: number
  /** Breathing gas O2 percentage (21 to 100) */
  readonly o2Percent: number
  /** Gradient Factor Low percentage (1 to 100) */
  readonly gfLowPercent: number
  /** Gradient Factor High percentage (1 to 100) */
  readonly gfHighPercent: number
  /** Ascent rate in m/min (> 0) */
  readonly ascentRateMPerMin: number
  /** Descent rate in m/min (> 0) */
  readonly descentRateMPerMin: number
  /** Decompression stop step interval in meters (> 0, e.g. 3) */
  readonly decoStepSizeMeters: number
  /** Shallowest mandatory decompression stop depth in meters (> 0, e.g. 3 or 6) */
  readonly lastStopDepthMeters: number
  /** ZH-L16C Compartment 1 variant ('ZHL16C_1B' = 4.0 min default, 'ZHL16C_1' = 5.0 min) */
  readonly variant?: Zhl16Variant
  /** Atmospheric surface pressure in bar (default 1.01325 bar) */
  readonly surfacePressureBar?: number
  /** Hydrostatic pressure gradient in bar/m (default 0.10 bar/m) */
  readonly barPerMeter?: number
  /** Alveolar water vapor pressure in bar (default 0.0627 bar) */
  readonly waterVaporPressureBar?: number
  /** Surface equilibrium N2 fraction before the dive (default 0.79) */
  readonly surfaceFN2?: number
  /** GF Low ramp anchor strategy (default 'first_stop') */
  readonly gfAnchorMode?: GfAnchorMode
}

export interface DivePlanResult {
  readonly input: Required<DivePlanInput>
  /** Descent duration from 0 m to depthMeters (min) */
  readonly descentDurationMinutes: number
  /** Time spent at constant bottom depth (min) */
  readonly flatBottomDurationMinutes: number
  /** Effective runtime when ascent begins (equals max(bottomTimeMinutes, descentDurationMinutes)) */
  readonly effectiveBottomTimeMinutes: number
  /** True if requested bottomTimeMinutes was shorter than descentDurationMinutes */
  readonly bottomTimeClampedToDescent: boolean
  /** Ordered profile segments (descent, bottom, ascent legs, and mandatory deco stops) */
  readonly segments: readonly DiveSegment[]
  /** Mandatory decompression stops only (never includes discretionary safety stops) */
  readonly decoStops: readonly DecoStop[]
  /** True when at least one mandatory decompression stop is required */
  readonly isDecoRequired: boolean
  /** Depth of first mandatory stop in meters, or null if NDL dive */
  readonly firstStopDepthMeters: number | null
  /** Sum of mandatory deco stop hold times in minutes */
  readonly totalDecoStopMinutes: number
  /** Time To Surface (TTS) from departure at bottom depth (ascent transit + mandatory stops) */
  readonly ttsMinutes: number
  /** Total dive runtime from t=0 to reaching the surface (min) */
  readonly totalRuntimeMinutes: number
  /** Whole-minute No-Decompression Limit (total bottom time) at target depth, or null if unlimited */
  readonly ndlMinutes: number | null
  /** True when tissues at target depth never exceed surface GF High even at infinite exposure */
  readonly isUnlimitedNdl: boolean
  /** Inspired O2 partial pressure at target bottom depth (bar) */
  readonly bottomPpO2Bar: number
  /** Maximum Operating Depth (m) for 1.4 bar ppO2 */
  readonly mod14Meters: number
  /** Maximum Operating Depth (m) for 1.6 bar ppO2 */
  readonly mod16Meters: number
  /** Leading compartment (1..16) upon reaching the surface */
  readonly surfaceLeadingCompartment: number
  /** Surfacing Gradient Factor fraction (e.g. 0.68 = 68% of M-value at surface) */
  readonly surfaceGf: number
  /** Final 16-compartment N2 tensions upon surfacing (bar) */
  readonly finalCompartmentN2Bar: readonly number[]
  /** Time-series samples for plotting profile and ceiling curves */
  readonly samples: readonly ProfileSample[]
}

/** Convert metric depth (m) to absolute pressure (bar). */
export function depthToPressure(
  depthMeters: number,
  surfacePressureBar: number = SURFACE_PRESSURE_STANDARD_BAR,
  barPerMeter: number = WATER_DENSITY_PRESETS.salt_metric.barPerMeter,
): number {
  return surfacePressureBar + depthMeters * barPerMeter
}

/** Convert absolute pressure (bar) to metric depth (m), clamped to >= 0. */
export function pressureToDepth(
  pressureBar: number,
  surfacePressureBar: number = SURFACE_PRESSURE_STANDARD_BAR,
  barPerMeter: number = WATER_DENSITY_PRESETS.salt_metric.barPerMeter,
): number {
  return Math.max(0, (pressureBar - surfacePressureBar) / barPerMeter)
}

/** Compute inspired alveolar inert N2 partial pressure (bar). */
export function alveolarN2Pressure(
  ambientPressureBar: number,
  fN2: number,
  waterVaporPressureBar: number = ALVEOLAR_WATER_VAPOR_PRESSURE_BAR,
): number {
  if (fN2 <= 0) return 0
  return Math.max(0, (ambientPressureBar - waterVaporPressureBar) * fN2)
}

/** Initialize 16 tissue compartments saturated with air at surface pressure. */
export function createSurfaceTissueState(
  surfacePressureBar: number = SURFACE_PRESSURE_STANDARD_BAR,
  surfaceFN2: number = STANDARD_AIR_FN2,
  waterVaporPressureBar: number = ALVEOLAR_WATER_VAPOR_PRESSURE_BAR,
): number[] {
  const initialN2 = alveolarN2Pressure(surfacePressureBar, surfaceFN2, waterVaporPressureBar)
  return Array.from({ length: 16 }, () => initialN2)
}

/** Exact Haldane equation for a single compartment at constant alveolar gas pressure. */
export function haldaneCompartment(
  initialTissuePressureBar: number,
  inspiredAlveolarPressureBar: number,
  durationMinutes: number,
  halfTimeMinutes: number,
): number {
  if (durationMinutes <= 0) return initialTissuePressureBar
  const k = LN2 / halfTimeMinutes
  return (
    inspiredAlveolarPressureBar +
    (initialTissuePressureBar - inspiredAlveolarPressureBar) * Math.exp(-k * durationMinutes)
  )
}

/**
 * Exact Schreiner equation for a single compartment under constant ambient pressure rate.
 *
 * @param initialTissuePressureBar Tissue inert gas tension at t=0 (bar)
 * @param startAmbientPressureBar Ambient absolute pressure at t=0 (bar)
 * @param ambientPressureRateBarPerMin Rate of ambient pressure change (bar/min, + descent / - ascent)
 * @param fN2 Inert N2 fraction in breathing mix (0..0.79)
 * @param durationMinutes Segment duration in minutes
 * @param halfTimeMinutes Compartment half-time in minutes
 * @param waterVaporPressureBar Alveolar water vapor pressure in bar
 */
export function schreinerCompartment(
  initialTissuePressureBar: number,
  startAmbientPressureBar: number,
  ambientPressureRateBarPerMin: number,
  fN2: number,
  durationMinutes: number,
  halfTimeMinutes: number,
  waterVaporPressureBar: number = ALVEOLAR_WATER_VAPOR_PRESSURE_BAR,
): number {
  if (durationMinutes <= 0) return initialTissuePressureBar
  if (Math.abs(ambientPressureRateBarPerMin) < 1e-12) {
    const pAlv = alveolarN2Pressure(startAmbientPressureBar, fN2, waterVaporPressureBar)
    return haldaneCompartment(initialTissuePressureBar, pAlv, durationMinutes, halfTimeMinutes)
  }
  const pAlv0 = (startAmbientPressureBar - waterVaporPressureBar) * fN2
  const r = ambientPressureRateBarPerMin * fN2
  const k = LN2 / halfTimeMinutes
  return (
    pAlv0 +
    r * (durationMinutes - 1 / k) -
    (pAlv0 - initialTissuePressureBar - r / k) * Math.exp(-k * durationMinutes)
  )
}

/** Update all 16 compartments at constant depth for `durationMinutes`. */
export function stepConstantDepth(
  state: readonly number[],
  ambientPressureBar: number,
  fN2: number,
  durationMinutes: number,
  compartments: readonly CompartmentCoefficients[],
  waterVaporPressureBar: number = ALVEOLAR_WATER_VAPOR_PRESSURE_BAR,
): number[] {
  if (durationMinutes <= 0) return [...state]
  const pAlv = alveolarN2Pressure(ambientPressureBar, fN2, waterVaporPressureBar)
  return compartments.map((comp, i) =>
    haldaneCompartment(state[i], pAlv, durationMinutes, comp.n2HalfTime),
  )
}

/** Update all 16 compartments during a linear depth change from `startAmbientBar` to `endAmbientBar`. */
export function stepLinearRamp(
  state: readonly number[],
  startAmbientBar: number,
  endAmbientBar: number,
  fN2: number,
  durationMinutes: number,
  compartments: readonly CompartmentCoefficients[],
  waterVaporPressureBar: number = ALVEOLAR_WATER_VAPOR_PRESSURE_BAR,
): number[] {
  if (durationMinutes <= 0) return [...state]
  const rateBarPerMin = (endAmbientBar - startAmbientBar) / durationMinutes
  return compartments.map((comp, i) =>
    schreinerCompartment(
      state[i],
      startAmbientBar,
      rateBarPerMin,
      fN2,
      durationMinutes,
      comp.n2HalfTime,
      waterVaporPressureBar,
    ),
  )
}

/** Maximum tolerated tissue tension (M-value) at `ambientPressureBar` scaled by `gf` (0..1). */
export function compartmentMValue(
  ambientPressureBar: number,
  a: number,
  b: number,
  gf: number = 1.0,
): number {
  const unscaledM = a + ambientPressureBar / b
  return ambientPressureBar + gf * (unscaledM - ambientPressureBar)
}

/**
 * Erik Baker Gradient-Factor-scaled minimum tolerated ambient pressure (ceiling in bar)
 * for a single compartment with tension `tissuePressureBar`.
 */
export function compartmentCeilingPressure(
  tissuePressureBar: number,
  a: number,
  b: number,
  gf: number,
): number {
  return (b * (tissuePressureBar - a * gf)) / (gf + b * (1 - gf))
}

/** Evaluate overall ceiling pressure and leading compartment across all 16 compartments. */
export function evaluateTissueCeiling(
  state: readonly number[],
  compartments: readonly CompartmentCoefficients[],
  gf: number,
): { ceilingPressureBar: number; leadingCompartment: number } {
  let maxPressure = -Infinity
  let leadingCompartment = 1

  for (let i = 0; i < compartments.length; i++) {
    const comp = compartments[i]
    const pCeil = compartmentCeilingPressure(state[i], comp.n2A, comp.n2B, gf)
    if (pCeil > maxPressure) {
      maxPressure = pCeil
      leadingCompartment = comp.index
    }
  }

  return { ceilingPressureBar: maxPressure, leadingCompartment }
}

/**
 * Evaluate instantaneous Gradient Factor (fraction of Bühlmann M-value supersaturation)
 * across all 16 compartments at `ambientPressureBar`.
 */
export function evaluateInstantaneousGf(
  state: readonly number[],
  ambientPressureBar: number,
  compartments: readonly CompartmentCoefficients[],
): { gf99: number; leadingCompartment: number } {
  let maxGf = 0
  let leadingCompartment = 1

  for (let i = 0; i < compartments.length; i++) {
    const comp = compartments[i]
    const mMax = comp.n2A + ambientPressureBar / comp.n2B
    const denom = mMax - ambientPressureBar
    if (denom > 0) {
      const gf = (state[i] - ambientPressureBar) / denom
      if (gf > maxGf) {
        maxGf = gf
        leadingCompartment = comp.index
      }
    }
  }

  return { gf99: Math.max(0, maxGf), leadingCompartment }
}

/**
 * Round a positive ceiling depth (m) up to the mandatory deco stop grid defined by
 * `lastStopDepthMeters` and `decoStepSizeMeters`:
 *   grid = { lastStopDepthMeters + k * decoStepSizeMeters | k = 0, 1, 2, ... }
 * Returns 0 when `ceilingDepthMeters <= 0`.
 */
export function roundUpToStopGrid(
  ceilingDepthMeters: number,
  decoStepSizeMeters: number,
  lastStopDepthMeters: number,
): number {
  if (ceilingDepthMeters <= EPSILON) return 0
  if (ceilingDepthMeters <= lastStopDepthMeters + EPSILON) {
    return lastStopDepthMeters
  }
  const stepsAboveLast = Math.ceil(
    (ceilingDepthMeters - lastStopDepthMeters - EPSILON) / decoStepSizeMeters,
  )
  return lastStopDepthMeters + stepsAboveLast * decoStepSizeMeters
}

function gfOnLinearRamp(
  depthMeters: number,
  anchorDepthMeters: number,
  gfLow: number,
  gfHigh: number,
): number {
  if (depthMeters <= 0 || anchorDepthMeters <= 0) return gfHigh
  if (depthMeters >= anchorDepthMeters) return gfLow
  return gfHigh + (gfLow - gfHigh) * (depthMeters / anchorDepthMeters)
}

/**
 * Compute continuous ceiling depth (m) against the active GF ramp line
 * from `(anchorDepthMeters, gfLow)` to `(0 m, gfHigh)`.
 */
function activeRampCeilingDepth(
  state: readonly number[],
  compartments: readonly CompartmentCoefficients[],
  anchorDepthMeters: number,
  gfLow: number,
  gfHigh: number,
  surfacePressureBar: number,
  barPerMeter: number,
): { ceilingDepthMeters: number; leadingCompartment: number } {
  const surfaceEval = evaluateTissueCeiling(state, compartments, gfHigh)
  if (surfaceEval.ceilingPressureBar <= surfacePressureBar + EPSILON) {
    return {
      ceilingDepthMeters: 0,
      leadingCompartment: surfaceEval.leadingCompartment,
    }
  }

  if (anchorDepthMeters <= 0 || Math.abs(gfHigh - gfLow) < 1e-12) {
    return {
      ceilingDepthMeters: pressureToDepth(
        surfaceEval.ceilingPressureBar,
        surfacePressureBar,
        barPerMeter,
      ),
      leadingCompartment: surfaceEval.leadingCompartment,
    }
  }

  // Binary search minimum depth d >= 0 where all compartments satisfy M_i(d, GF(d)) >= state[i]
  const lowCheck = evaluateTissueCeiling(state, compartments, Math.min(gfLow, gfHigh))
  let lo = 0
  let hi = Math.max(
    anchorDepthMeters,
    pressureToDepth(lowCheck.ceilingPressureBar, surfacePressureBar, barPerMeter) + 1,
  )

  for (let iter = 0; iter < 32; iter++) {
    const mid = 0.5 * (lo + hi)
    const gfMid = gfOnLinearRamp(mid, anchorDepthMeters, gfLow, gfHigh)
    const pMid = depthToPressure(mid, surfacePressureBar, barPerMeter)
    const { ceilingPressureBar } = evaluateTissueCeiling(state, compartments, gfMid)
    if (ceilingPressureBar > pMid) {
      lo = mid
    } else {
      hi = mid
    }
  }

  const gfFinal = gfOnLinearRamp(hi, anchorDepthMeters, gfLow, gfHigh)
  const { leadingCompartment } = evaluateTissueCeiling(state, compartments, gfFinal)
  return { ceilingDepthMeters: hi, leadingCompartment }
}

interface NormalizedConfig {
  readonly input: Required<DivePlanInput>
  readonly compartments: readonly CompartmentCoefficients[]
  readonly fO2: number
  readonly fN2: number
  readonly gfLow: number
  readonly gfHigh: number
}

function normalizeInput(raw: DivePlanInput): NormalizedConfig {
  if (!Number.isFinite(raw.depthMeters) || raw.depthMeters <= 0) {
    throw new RangeError('depthMeters must be greater than 0')
  }
  if (!Number.isFinite(raw.bottomTimeMinutes) || raw.bottomTimeMinutes <= 0) {
    throw new RangeError('bottomTimeMinutes must be greater than 0')
  }
  if (!Number.isFinite(raw.o2Percent) || raw.o2Percent < 21 || raw.o2Percent > 100) {
    throw new RangeError('o2Percent must be between 21 and 100')
  }
  if (!Number.isFinite(raw.gfLowPercent) || raw.gfLowPercent < 1 || raw.gfLowPercent > 100) {
    throw new RangeError('gfLowPercent must be between 1 and 100')
  }
  if (!Number.isFinite(raw.gfHighPercent) || raw.gfHighPercent < 1 || raw.gfHighPercent > 100) {
    throw new RangeError('gfHighPercent must be between 1 and 100')
  }
  if (!Number.isFinite(raw.ascentRateMPerMin) || raw.ascentRateMPerMin <= 0) {
    throw new RangeError('ascentRateMPerMin must be greater than 0')
  }
  if (!Number.isFinite(raw.descentRateMPerMin) || raw.descentRateMPerMin <= 0) {
    throw new RangeError('descentRateMPerMin must be greater than 0')
  }
  if (!Number.isFinite(raw.decoStepSizeMeters) || raw.decoStepSizeMeters <= 0) {
    throw new RangeError('decoStepSizeMeters must be greater than 0')
  }
  if (!Number.isFinite(raw.lastStopDepthMeters) || raw.lastStopDepthMeters <= 0) {
    throw new RangeError('lastStopDepthMeters must be greater than 0')
  }

  const input: Required<DivePlanInput> = {
    depthMeters: raw.depthMeters,
    bottomTimeMinutes: raw.bottomTimeMinutes,
    o2Percent: raw.o2Percent,
    gfLowPercent: raw.gfLowPercent,
    gfHighPercent: raw.gfHighPercent,
    ascentRateMPerMin: raw.ascentRateMPerMin,
    descentRateMPerMin: raw.descentRateMPerMin,
    decoStepSizeMeters: raw.decoStepSizeMeters,
    lastStopDepthMeters: raw.lastStopDepthMeters,
    variant: raw.variant ?? 'ZHL16C_1B',
    surfacePressureBar: raw.surfacePressureBar ?? SURFACE_PRESSURE_STANDARD_BAR,
    barPerMeter: raw.barPerMeter ?? WATER_DENSITY_PRESETS.salt_metric.barPerMeter,
    waterVaporPressureBar: raw.waterVaporPressureBar ?? ALVEOLAR_WATER_VAPOR_PRESSURE_BAR,
    surfaceFN2: raw.surfaceFN2 ?? STANDARD_AIR_FN2,
    gfAnchorMode: raw.gfAnchorMode ?? 'continuous_ceiling',
  }

  const fO2 = input.o2Percent / 100
  const fN2 = Math.max(0, 1 - fO2)

  return {
    input,
    compartments: getCompartments(input.variant),
    fO2,
    fN2,
    gfLow: input.gfLowPercent / 100,
    gfHigh: input.gfHighPercent / 100,
  }
}

function simulateAscentLeg(
  state: readonly number[],
  fromDepthMeters: number,
  toDepthMeters: number,
  cfg: NormalizedConfig,
): { endState: number[]; durationMinutes: number } {
  const distance = Math.abs(fromDepthMeters - toDepthMeters)
  if (distance < 1e-12) {
    return { endState: [...state], durationMinutes: 0 }
  }
  const rate =
    toDepthMeters < fromDepthMeters
      ? cfg.input.ascentRateMPerMin
      : cfg.input.descentRateMPerMin
  const durationMinutes = distance / rate
  const startBar = depthToPressure(
    fromDepthMeters,
    cfg.input.surfacePressureBar,
    cfg.input.barPerMeter,
  )
  const endBar = depthToPressure(
    toDepthMeters,
    cfg.input.surfacePressureBar,
    cfg.input.barPerMeter,
  )
  const endState = stepLinearRamp(
    state,
    startBar,
    endBar,
    cfg.fN2,
    durationMinutes,
    cfg.compartments,
    cfg.input.waterVaporPressureBar,
  )
  return { endState, durationMinutes }
}

function canAscendToDepth(
  state: readonly number[],
  fromDepthMeters: number,
  targetDepthMeters: number,
  targetGf: number,
  cfg: NormalizedConfig,
): { ok: boolean; arrivalState: number[]; leadingCompartment: number } {
  const { endState } = simulateAscentLeg(state, fromDepthMeters, targetDepthMeters, cfg)
  const targetBar = depthToPressure(
    targetDepthMeters,
    cfg.input.surfacePressureBar,
    cfg.input.barPerMeter,
  )
  const { ceilingPressureBar, leadingCompartment } = evaluateTissueCeiling(
    endState,
    cfg.compartments,
    targetGf,
  )
  return {
    ok: ceilingPressureBar <= targetBar + EPSILON,
    arrivalState: endState,
    leadingCompartment,
  }
}

/**
 * Resolve mandatory decompression stops starting from `bottomState` at `depthMeters`.
 * Never adds discretionary safety stops: if direct ascent to 0 m satisfies `gfHigh`,
 * the dive is within NDL and `decoStops` is empty.
 */
function computeDecompressionAscent(
  bottomState: readonly number[],
  maxBottomGfLowCeilingMeters: number,
  cfg: NormalizedConfig,
): {
  decoStops: DecoStop[]
  anchorDepthMeters: number
} {
  const {
    depthMeters,
    decoStepSizeMeters,
    lastStopDepthMeters,
    surfacePressureBar,
    barPerMeter,
    waterVaporPressureBar,
    gfAnchorMode,
  } = cfg.input

  // 1. Universal NDL check: if direct ascent from bottom to 0 m satisfies GF High,
  // no mandatory decompression stops are required (GF Low only shapes stops once in deco).
  if (canAscendToDepth(bottomState, depthMeters, 0, cfg.gfHigh, cfg).ok) {
    return { decoStops: [], anchorDepthMeters: 0 }
  }

  // Build candidate stop grid from deepest possible stop down to lastStopDepthMeters
  const bottomGfLowEval = evaluateTissueCeiling(bottomState, cfg.compartments, cfg.gfLow)
  const bottomGfLowDepth = pressureToDepth(
    bottomGfLowEval.ceilingPressureBar,
    surfacePressureBar,
    barPerMeter,
  )
  const maxCandidateCeiling = Math.max(depthMeters, bottomGfLowDepth)
  const deepestGridStop = roundUpToStopGrid(
    maxCandidateCeiling,
    decoStepSizeMeters,
    lastStopDepthMeters,
  )

  if (gfAnchorMode === 'continuous_ceiling') {
    // Subsurface / Shearwater continuous ceiling anchor (floored at +1.0 bar / ~10 m when in deco)
    const minAnchorMeters = 1.0 / barPerMeter
    let trackedMaxGfLowCeiling = Math.max(maxBottomGfLowCeilingMeters, bottomGfLowDepth)

    const candidateStops: number[] = []
    for (
      let d = deepestGridStop;
      d >= lastStopDepthMeters - EPSILON;
      d = Math.round((d - decoStepSizeMeters) * 1e6) / 1e6
    ) {
      if (d <= depthMeters + EPSILON || d <= bottomGfLowDepth + decoStepSizeMeters) {
        candidateStops.push(d)
      }
    }

    let currentDepth = depthMeters
    let currentState = [...bottomState]
    let currentRuntime = 0
    const decoStops: DecoStop[] = []

    for (let idx = 0; idx < candidateStops.length; idx++) {
      const stopDepth = candidateStops[idx]
      const nextDepth =
        idx + 1 < candidateStops.length ? candidateStops[idx + 1] : 0
      const curAnchor = Math.max(minAnchorMeters, trackedMaxGfLowCeiling)
      const gfAtNext = gfOnLinearRamp(nextDepth, curAnchor, cfg.gfLow, cfg.gfHigh)

      // Skip candidate stopDepth if ascending directly from currentDepth to nextDepth clears gfAtNext
      const skipCheck = canAscendToDepth(currentState, currentDepth, nextDepth, gfAtNext, cfg)
      if (skipCheck.ok) {
        continue
      }

      const transit = simulateAscentLeg(currentState, currentDepth, stopDepth, cfg)
      currentState = transit.endState
      currentRuntime += transit.durationMinutes
      currentDepth = stopDepth

      const arrivalCeiling = evaluateTissueCeiling(currentState, cfg.compartments, cfg.gfLow)
      trackedMaxGfLowCeiling = Math.max(
        trackedMaxGfLowCeiling,
        pressureToDepth(arrivalCeiling.ceilingPressureBar, surfacePressureBar, barPerMeter),
      )

      const stopAnchor = Math.max(minAnchorMeters, trackedMaxGfLowCeiling)
      const targetGf = gfOnLinearRamp(nextDepth, stopAnchor, cfg.gfLow, cfg.gfHigh)
      const stopBar = depthToPressure(stopDepth, surfacePressureBar, barPerMeter)

      let holdMinutes = 0
      let controllingComp = arrivalCeiling.leadingCompartment
      while (holdMinutes < MAX_STOP_MINUTES) {
        const trial = canAscendToDepth(currentState, stopDepth, nextDepth, targetGf, cfg)
        controllingComp = trial.leadingCompartment
        if (trial.ok) break
        currentState = stepConstantDepth(
          currentState,
          stopBar,
          cfg.fN2,
          1,
          cfg.compartments,
          waterVaporPressureBar,
        )
        holdMinutes += 1
      }

      if (holdMinutes > 0) {
        decoStops.push({
          depthMeters: stopDepth,
          durationMinutes: holdMinutes,
          arrivalRuntimeMinutes: currentRuntime,
          departureRuntimeMinutes: currentRuntime + holdMinutes,
          nextDepthMeters: nextDepth,
          targetGf,
          leadingCompartment: controllingComp,
        })
        currentRuntime += holdMinutes
      }
    }

    return {
      decoStops,
      anchorDepthMeters:
        decoStops.length > 0 ? Math.max(minAnchorMeters, trackedMaxGfLowCeiling) : 0,
    }
  }

  // Alternate strategy: Erik Baker / MultiDeco / DecoTengu grid-anchored 'first_stop' mode.
  const canReachLastStopAtGfLow =
    depthMeters <= lastStopDepthMeters
      ? evaluateTissueCeiling(bottomState, cfg.compartments, cfg.gfLow).ceilingPressureBar <=
        depthToPressure(lastStopDepthMeters, surfacePressureBar, barPerMeter) + EPSILON
      : canAscendToDepth(bottomState, depthMeters, lastStopDepthMeters, cfg.gfLow, cfg).ok

  let firstStopDepth = lastStopDepthMeters
  if (!canReachLastStopAtGfLow) {
    let candidate = lastStopDepthMeters + decoStepSizeMeters
    while (candidate < deepestGridStop + decoStepSizeMeters) {
      const ok =
        candidate >= depthMeters
          ? evaluateTissueCeiling(bottomState, cfg.compartments, cfg.gfLow).ceilingPressureBar <=
            depthToPressure(candidate, surfacePressureBar, barPerMeter) + EPSILON
          : canAscendToDepth(bottomState, depthMeters, candidate, cfg.gfLow, cfg).ok
      if (ok) {
        firstStopDepth = candidate
        break
      }
      candidate = Math.round((candidate + decoStepSizeMeters) * 1e6) / 1e6
    }
  }

  const stopGrid: number[] = []
  for (
    let d = firstStopDepth;
    d >= lastStopDepthMeters - EPSILON;
    d = Math.round((d - decoStepSizeMeters) * 1e6) / 1e6
  ) {
    stopGrid.push(d)
  }

  let currentDepth = depthMeters
  let currentState = [...bottomState]
  let elapsedSinceBottom = 0
  const decoStops: DecoStop[] = []

  for (let i = 0; i < stopGrid.length; i++) {
    const stopDepth = stopGrid[i]
    const nextDepth = i + 1 < stopGrid.length ? stopGrid[i + 1] : 0
    const targetGf = gfOnLinearRamp(nextDepth, firstStopDepth, cfg.gfLow, cfg.gfHigh)

    const transit = simulateAscentLeg(currentState, currentDepth, stopDepth, cfg)
    const stateAtStop = transit.endState

    const zeroHoldTrial = canAscendToDepth(stateAtStop, stopDepth, nextDepth, targetGf, cfg)
    if (i > 0 && zeroHoldTrial.ok) {
      currentState = stateAtStop
      elapsedSinceBottom += transit.durationMinutes
      currentDepth = stopDepth
      continue
    }

    currentState = stateAtStop
    elapsedSinceBottom += transit.durationMinutes
    currentDepth = stopDepth

    const arrivalTime = elapsedSinceBottom
    const stopBar = depthToPressure(stopDepth, surfacePressureBar, barPerMeter)
    let holdMinutes = 0
    let controllingComp = zeroHoldTrial.leadingCompartment

    while (holdMinutes < MAX_STOP_MINUTES) {
      currentState = stepConstantDepth(
        currentState,
        stopBar,
        cfg.fN2,
        1,
        cfg.compartments,
        waterVaporPressureBar,
      )
      holdMinutes += 1
      const trial = canAscendToDepth(currentState, stopDepth, nextDepth, targetGf, cfg)
      controllingComp = trial.leadingCompartment
      if (trial.ok) break
    }

    elapsedSinceBottom += holdMinutes
    decoStops.push({
      depthMeters: stopDepth,
      durationMinutes: holdMinutes,
      arrivalRuntimeMinutes: arrivalTime,
      departureRuntimeMinutes: elapsedSinceBottom,
      nextDepthMeters: nextDepth,
      targetGf,
      leadingCompartment: controllingComp,
    })
  }

  return {
    decoStops,
    anchorDepthMeters: decoStops.length > 0 ? firstStopDepth : 0,
  }
}

/** Check whether a given bottomTimeMinutes requires any mandatory decompression stop. */
function requiresMandatoryDecoForBottomTime(
  bottomTimeMinutes: number,
  cfg: NormalizedConfig,
): boolean {
  const { depthMeters, descentRateMPerMin, surfacePressureBar, barPerMeter, waterVaporPressureBar } =
    cfg.input
  const descentDuration = depthMeters / descentRateMPerMin
  const effectiveBottom = Math.max(bottomTimeMinutes, descentDuration)
  const flatDuration = Math.max(0, effectiveBottom - descentDuration)

  const initialState = createSurfaceTissueState(
    surfacePressureBar,
    cfg.input.surfaceFN2,
    waterVaporPressureBar,
  )
  const bottomBar = depthToPressure(depthMeters, surfacePressureBar, barPerMeter)
  const afterDescent = stepLinearRamp(
    initialState,
    surfacePressureBar,
    bottomBar,
    cfg.fN2,
    descentDuration,
    cfg.compartments,
    waterVaporPressureBar,
  )
  const afterBottom = stepConstantDepth(
    afterDescent,
    bottomBar,
    cfg.fN2,
    flatDuration,
    cfg.compartments,
    waterVaporPressureBar,
  )
  const maxCeilingAtBottom = pressureToDepth(
    evaluateTissueCeiling(afterBottom, cfg.compartments, cfg.gfLow).ceilingPressureBar,
    surfacePressureBar,
    barPerMeter,
  )
  const { decoStops } = computeDecompressionAscent(afterBottom, maxCeilingAtBottom, cfg)
  return decoStops.length > 0
}

/**
 * Compute whole-minute No-Decompression Limit (total bottom time in minutes from t=0)
 * for the target depth, mix, rates, and gradient factors.
 * Returns `null` if even infinite exposure at target depth requires 0 mandatory deco stops.
 */
export function calculateNdlMinutes(rawInput: DivePlanInput): number | null {
  const cfg = normalizeInput(rawInput)

  // Check equilibrium exposure (10,000 min > 15x slowest 635 min compartment)
  if (!requiresMandatoryDecoForBottomTime(10000, cfg)) {
    return null
  }

  const minTime = Math.ceil(cfg.input.depthMeters / cfg.input.descentRateMPerMin)
  if (requiresMandatoryDecoForBottomTime(minTime, cfg)) {
    return 0
  }

  let lo = minTime
  let hi = minTime + 1
  while (hi < 10000 && !requiresMandatoryDecoForBottomTime(hi, cfg)) {
    lo = hi
    hi *= 2
  }
  hi = Math.min(hi, 10000)

  while (lo + 1 < hi) {
    const mid = Math.floor(0.5 * (lo + hi))
    if (requiresMandatoryDecoForBottomTime(mid, cfg)) {
      hi = mid
    } else {
      lo = mid
    }
  }

  return lo
}

/**
 * Plan a single-gas Nitrox dive under Bühlmann ZH-L16C + Erik Baker Gradient Factors,
 * returning mandatory decompression stops (never discretionary safety stops), segments,
 * summary metrics, NDL at target depth, and time-series samples for visualization.
 */
export function planDive(rawInput: DivePlanInput): DivePlanResult {
  const cfg = normalizeInput(rawInput)
  const {
    depthMeters,
    bottomTimeMinutes,
    descentRateMPerMin,
    surfacePressureBar,
    barPerMeter,
    waterVaporPressureBar,
    surfaceFN2,
  } = cfg.input

  const descentDurationMinutes = depthMeters / descentRateMPerMin
  const bottomTimeClampedToDescent = bottomTimeMinutes < descentDurationMinutes - EPSILON
  const effectiveBottomTimeMinutes = Math.max(bottomTimeMinutes, descentDurationMinutes)
  const flatBottomDurationMinutes = Math.max(
    0,
    effectiveBottomTimeMinutes - descentDurationMinutes,
  )

  const initialState = createSurfaceTissueState(
    surfacePressureBar,
    surfaceFN2,
    waterVaporPressureBar,
  )
  const bottomBar = depthToPressure(depthMeters, surfacePressureBar, barPerMeter)

  const afterDescentState = stepLinearRamp(
    initialState,
    surfacePressureBar,
    bottomBar,
    cfg.fN2,
    descentDurationMinutes,
    cfg.compartments,
    waterVaporPressureBar,
  )

  const afterBottomState = stepConstantDepth(
    afterDescentState,
    bottomBar,
    cfg.fN2,
    flatBottomDurationMinutes,
    cfg.compartments,
    waterVaporPressureBar,
  )

  const bottomGfLowDepth = pressureToDepth(
    evaluateTissueCeiling(afterBottomState, cfg.compartments, cfg.gfLow).ceilingPressureBar,
    surfacePressureBar,
    barPerMeter,
  )

  const { decoStops: relativeStops, anchorDepthMeters } = computeDecompressionAscent(
    afterBottomState,
    bottomGfLowDepth,
    cfg,
  )

  // Offset stop runtimes by effectiveBottomTimeMinutes and build clean DiveSegment[] list
  const decoStops: DecoStop[] = relativeStops.map((s) => ({
    ...s,
    arrivalRuntimeMinutes: effectiveBottomTimeMinutes + s.arrivalRuntimeMinutes,
    departureRuntimeMinutes: effectiveBottomTimeMinutes + s.departureRuntimeMinutes,
  }))

  const segments: DiveSegment[] = [
    {
      type: 'descent',
      startTimeMinutes: 0,
      endTimeMinutes: descentDurationMinutes,
      durationMinutes: descentDurationMinutes,
      startDepthMeters: 0,
      endDepthMeters: depthMeters,
    },
  ]

  if (flatBottomDurationMinutes > EPSILON) {
    segments.push({
      type: 'bottom',
      startTimeMinutes: descentDurationMinutes,
      endTimeMinutes: effectiveBottomTimeMinutes,
      durationMinutes: flatBottomDurationMinutes,
      startDepthMeters: depthMeters,
      endDepthMeters: depthMeters,
    })
  }

  let cursorTime = effectiveBottomTimeMinutes
  let cursorDepth = depthMeters

  for (const stop of decoStops) {
    const ascentDuration = stop.arrivalRuntimeMinutes - cursorTime
    if (ascentDuration > EPSILON) {
      segments.push({
        type: 'ascent',
        startTimeMinutes: cursorTime,
        endTimeMinutes: stop.arrivalRuntimeMinutes,
        durationMinutes: ascentDuration,
        startDepthMeters: cursorDepth,
        endDepthMeters: stop.depthMeters,
      })
    }
    segments.push({
      type: 'deco_stop',
      startTimeMinutes: stop.arrivalRuntimeMinutes,
      endTimeMinutes: stop.departureRuntimeMinutes,
      durationMinutes: stop.durationMinutes,
      startDepthMeters: stop.depthMeters,
      endDepthMeters: stop.depthMeters,
    })
    cursorTime = stop.departureRuntimeMinutes
    cursorDepth = stop.depthMeters
  }

  // Final ascent leg from last stop (or bottom if NDL) to 0 m surface
  if (cursorDepth > EPSILON) {
    const finalAscentDuration = cursorDepth / cfg.input.ascentRateMPerMin
    segments.push({
      type: 'ascent',
      startTimeMinutes: cursorTime,
      endTimeMinutes: cursorTime + finalAscentDuration,
      durationMinutes: finalAscentDuration,
      startDepthMeters: cursorDepth,
      endDepthMeters: 0,
    })
    cursorTime += finalAscentDuration
  }

  const totalRuntimeMinutes = cursorTime
  const ttsMinutes = totalRuntimeMinutes - effectiveBottomTimeMinutes
  const totalDecoStopMinutes = decoStops.reduce((sum, s) => sum + s.durationMinutes, 0)

  // Generate high-resolution ProfileSample[] with exact points at every segment corner
  const samples: ProfileSample[] = []
  let simState = [...initialState]

  const createSample = (timeMinutes: number, depth: number, state: readonly number[]): ProfileSample => {
    const ambBar = depthToPressure(depth, surfacePressureBar, barPerMeter)
    const gfLowCeil = pressureToDepth(
      evaluateTissueCeiling(state, cfg.compartments, cfg.gfLow).ceilingPressureBar,
      surfacePressureBar,
      barPerMeter,
    )
    const gfHighCeil = pressureToDepth(
      evaluateTissueCeiling(state, cfg.compartments, cfg.gfHigh).ceilingPressureBar,
      surfacePressureBar,
      barPerMeter,
    )
    const activeCeil = activeRampCeilingDepth(
      state,
      cfg.compartments,
      anchorDepthMeters,
      cfg.gfLow,
      cfg.gfHigh,
      surfacePressureBar,
      barPerMeter,
    )
    const { gf99, leadingCompartment: instLead } = evaluateInstantaneousGf(
      state,
      ambBar,
      cfg.compartments,
    )

    return {
      timeMinutes,
      depthMeters: depth,
      ambientPressureBar: ambBar,
      ceilingDepthMeters: activeCeil.ceilingDepthMeters,
      gfLowCeilingMeters: gfLowCeil,
      gfHighCeilingMeters: gfHighCeil,
      leadingCompartment:
        activeCeil.ceilingDepthMeters > EPSILON ? activeCeil.leadingCompartment : instLead,
      gf99,
      compartmentN2Bar: [...state],
    }
  }

  // Target ~0.25-0.5 min resolution depending on total runtime (keeping ~150-350 points)
  const maxStepMinutes = Math.max(0.2, Math.min(1.0, totalRuntimeMinutes / 200))
  samples.push(createSample(0, 0, simState))

  for (const seg of segments) {
    const steps = Math.max(1, Math.ceil(seg.durationMinutes / maxStepMinutes))
    const dt = seg.durationMinutes / steps
    for (let k = 1; k <= steps; k++) {
      const t0 = seg.startTimeMinutes + (k - 1) * dt
      const t1 = k === steps ? seg.endTimeMinutes : seg.startTimeMinutes + k * dt
      const d0 =
        seg.startDepthMeters +
        ((seg.endDepthMeters - seg.startDepthMeters) * (k - 1)) / steps
      const d1 =
        k === steps
          ? seg.endDepthMeters
          : seg.startDepthMeters +
            ((seg.endDepthMeters - seg.startDepthMeters) * k) / steps
      const p0 = depthToPressure(d0, surfacePressureBar, barPerMeter)
      const p1 = depthToPressure(d1, surfacePressureBar, barPerMeter)
      const stepDt = t1 - t0

      if (Math.abs(d1 - d0) < 1e-12) {
        simState = stepConstantDepth(
          simState,
          p0,
          cfg.fN2,
          stepDt,
          cfg.compartments,
          waterVaporPressureBar,
        )
      } else {
        simState = stepLinearRamp(
          simState,
          p0,
          p1,
          cfg.fN2,
          stepDt,
          cfg.compartments,
          waterVaporPressureBar,
        )
      }
      samples.push(createSample(t1, d1, simState))
    }
  }

  const finalSample = samples[samples.length - 1]
  const surfaceGfEval = evaluateInstantaneousGf(
    finalSample.compartmentN2Bar,
    surfacePressureBar,
    cfg.compartments,
  )

  const ndlMinutes = calculateNdlMinutes(cfg.input)
  const bottomPpO2Bar = bottomBar * cfg.fO2
  const mod14Meters = pressureToDepth(1.4 / cfg.fO2, surfacePressureBar, barPerMeter)
  const mod16Meters = pressureToDepth(1.6 / cfg.fO2, surfacePressureBar, barPerMeter)

  return {
    input: cfg.input,
    descentDurationMinutes,
    flatBottomDurationMinutes,
    effectiveBottomTimeMinutes,
    bottomTimeClampedToDescent,
    segments,
    decoStops,
    isDecoRequired: decoStops.length > 0,
    firstStopDepthMeters: decoStops.length > 0 ? decoStops[0].depthMeters : null,
    totalDecoStopMinutes,
    ttsMinutes,
    totalRuntimeMinutes,
    ndlMinutes,
    isUnlimitedNdl: ndlMinutes === null,
    bottomPpO2Bar,
    mod14Meters,
    mod16Meters,
    surfaceLeadingCompartment: surfaceGfEval.leadingCompartment,
    surfaceGf: surfaceGfEval.gf99,
    finalCompartmentN2Bar: finalSample.compartmentN2Bar,
    samples,
  }
}

export interface NdlCurveInput {
  /** Minimum sweep depth in meters (> 0) */
  readonly minDepthMeters: number
  /** Maximum sweep depth in meters (>= minDepthMeters) */
  readonly maxDepthMeters: number
  /** Depth increment in meters (> 0, e.g. 1 or 3) */
  readonly depthStepMeters: number
  /** Breathing gas O2 percentage (21 to 100) */
  readonly o2Percent: number
  /** Gradient Factor High percentage (1 to 100) */
  readonly gfHighPercent: number
  /** Ascent rate in m/min (> 0) */
  readonly ascentRateMPerMin: number
  /** Descent rate in m/min (> 0) */
  readonly descentRateMPerMin: number
  /** ZH-L16C Compartment 1 variant ('ZHL16C_1B' = 4.0 min default, 'ZHL16C_1' = 5.0 min) */
  readonly variant?: Zhl16Variant
  /** Atmospheric surface pressure in bar (default 1.01325 bar) */
  readonly surfacePressureBar?: number
  /** Hydrostatic pressure gradient in bar/m (default 0.10 bar/m) */
  readonly barPerMeter?: number
  /** Alveolar water vapor pressure in bar (default 0.0627 bar) */
  readonly waterVaporPressureBar?: number
  /** Surface equilibrium N2 fraction before the dive (default 0.79) */
  readonly surfaceFN2?: number
}

export interface NdlCurvePoint {
  /** Depth in meters */
  readonly depthMeters: number
  /** Whole-minute NDL (total bottom time from t=0), or null if unlimited */
  readonly ndlMinutes: number | null
  /** True when tissues never exceed GF High upon direct ascent at infinite exposure */
  readonly isUnlimited: boolean
  /** 1-based leading compartment (1..16) controlling surfacing at the NDL boundary */
  readonly leadingCompartment: number
  /** Surfacing GF fraction achieved at NDL (0..gfHigh) */
  readonly surfaceGfAtNdl: number
  /** Inspired O2 partial pressure at this depth (bar) */
  readonly bottomPpO2Bar: number
}

export interface NdlCurveResult {
  readonly input: Required<NdlCurveInput>
  readonly points: readonly NdlCurvePoint[]
  /** Deepest swept depth where NDL is still unlimited, or null if none */
  readonly deepestUnlimitedDepthMeters: number | null
  /** Shallowest swept depth with a finite NDL, or null if all points are unlimited */
  readonly shallowestFiniteDepthMeters: number | null
  /** Maximum Operating Depth (m) for 1.4 bar ppO2 */
  readonly mod14Meters: number
  /** Maximum Operating Depth (m) for 1.6 bar ppO2 */
  readonly mod16Meters: number
}

function evaluateSurfaceAfterDirectAscent(
  bottomTimeMinutes: number,
  cfg: NormalizedConfig,
): { ok: boolean; leadingCompartment: number; surfaceGf: number } {
  const { depthMeters, descentRateMPerMin, surfacePressureBar, barPerMeter, waterVaporPressureBar } =
    cfg.input
  const descentDuration = depthMeters / descentRateMPerMin
  const effectiveBottom = Math.max(bottomTimeMinutes, descentDuration)
  const flatDuration = Math.max(0, effectiveBottom - descentDuration)

  const initialState = createSurfaceTissueState(
    surfacePressureBar,
    cfg.input.surfaceFN2,
    waterVaporPressureBar,
  )
  const bottomBar = depthToPressure(depthMeters, surfacePressureBar, barPerMeter)
  const afterDescent = stepLinearRamp(
    initialState,
    surfacePressureBar,
    bottomBar,
    cfg.fN2,
    descentDuration,
    cfg.compartments,
    waterVaporPressureBar,
  )
  const afterBottom = stepConstantDepth(
    afterDescent,
    bottomBar,
    cfg.fN2,
    flatDuration,
    cfg.compartments,
    waterVaporPressureBar,
  )
  const { endState } = simulateAscentLeg(afterBottom, depthMeters, 0, cfg)
  const { ceilingPressureBar, leadingCompartment } = evaluateTissueCeiling(
    endState,
    cfg.compartments,
    cfg.gfHigh,
  )
  const { gf99 } = evaluateInstantaneousGf(endState, surfacePressureBar, cfg.compartments)
  return {
    ok: ceilingPressureBar <= surfacePressureBar + EPSILON,
    leadingCompartment,
    surfaceGf: gf99,
  }
}

/**
 * Compute an NDL-vs-depth curve across `[minDepthMeters, maxDepthMeters]`
 * for a given `gfHighPercent`, breathing mix, and ascent/descent rates.
 */
export function calculateNdlCurve(rawInput: NdlCurveInput): NdlCurveResult {
  if (!Number.isFinite(rawInput.minDepthMeters) || rawInput.minDepthMeters <= 0) {
    throw new RangeError('minDepthMeters must be greater than 0')
  }
  if (
    !Number.isFinite(rawInput.maxDepthMeters) ||
    rawInput.maxDepthMeters < rawInput.minDepthMeters
  ) {
    throw new RangeError('maxDepthMeters must be >= minDepthMeters')
  }
  if (!Number.isFinite(rawInput.depthStepMeters) || rawInput.depthStepMeters <= 0) {
    throw new RangeError('depthStepMeters must be greater than 0')
  }

  const normalizedBase = normalizeInput({
    depthMeters: rawInput.minDepthMeters,
    bottomTimeMinutes: 10,
    o2Percent: rawInput.o2Percent,
    gfLowPercent: rawInput.gfHighPercent,
    gfHighPercent: rawInput.gfHighPercent,
    ascentRateMPerMin: rawInput.ascentRateMPerMin,
    descentRateMPerMin: rawInput.descentRateMPerMin,
    decoStepSizeMeters: 3,
    lastStopDepthMeters: 3,
    variant: rawInput.variant,
    surfacePressureBar: rawInput.surfacePressureBar,
    barPerMeter: rawInput.barPerMeter,
    waterVaporPressureBar: rawInput.waterVaporPressureBar,
    surfaceFN2: rawInput.surfaceFN2,
  })

  const fullInput: Required<NdlCurveInput> = {
    minDepthMeters: rawInput.minDepthMeters,
    maxDepthMeters: rawInput.maxDepthMeters,
    depthStepMeters: rawInput.depthStepMeters,
    o2Percent: normalizedBase.input.o2Percent,
    gfHighPercent: normalizedBase.input.gfHighPercent,
    ascentRateMPerMin: normalizedBase.input.ascentRateMPerMin,
    descentRateMPerMin: normalizedBase.input.descentRateMPerMin,
    variant: normalizedBase.input.variant,
    surfacePressureBar: normalizedBase.input.surfacePressureBar,
    barPerMeter: normalizedBase.input.barPerMeter,
    waterVaporPressureBar: normalizedBase.input.waterVaporPressureBar,
    surfaceFN2: normalizedBase.input.surfaceFN2,
  }

  const points: NdlCurvePoint[] = []
  const maxSteps = 500
  let stepCount = 0

  for (
    let d = fullInput.minDepthMeters;
    d <= fullInput.maxDepthMeters + EPSILON && stepCount < maxSteps;
    d = Math.round((d + fullInput.depthStepMeters) * 1e6) / 1e6, stepCount++
  ) {
    const depthCfg: NormalizedConfig = {
      ...normalizedBase,
      input: {
        ...normalizedBase.input,
        depthMeters: d,
      },
    }

    const eqEval = evaluateSurfaceAfterDirectAscent(10000, depthCfg)
    const bottomBar = depthToPressure(d, fullInput.surfacePressureBar, fullInput.barPerMeter)
    const bottomPpO2Bar = bottomBar * normalizedBase.fO2

    if (eqEval.ok) {
      points.push({
        depthMeters: d,
        ndlMinutes: null,
        isUnlimited: true,
        leadingCompartment: eqEval.leadingCompartment,
        surfaceGfAtNdl: eqEval.surfaceGf,
        bottomPpO2Bar,
      })
      continue
    }

    const minTime = Math.ceil(d / fullInput.descentRateMPerMin)
    const minEval = evaluateSurfaceAfterDirectAscent(minTime, depthCfg)
    if (!minEval.ok) {
      points.push({
        depthMeters: d,
        ndlMinutes: 0,
        isUnlimited: false,
        leadingCompartment: minEval.leadingCompartment,
        surfaceGfAtNdl: minEval.surfaceGf,
        bottomPpO2Bar,
      })
      continue
    }

    let lo = minTime
    let hi = minTime + 1
    while (hi < 10000 && evaluateSurfaceAfterDirectAscent(hi, depthCfg).ok) {
      lo = hi
      hi *= 2
    }
    hi = Math.min(hi, 10000)

    while (lo + 1 < hi) {
      const mid = Math.floor(0.5 * (lo + hi))
      if (evaluateSurfaceAfterDirectAscent(mid, depthCfg).ok) {
        lo = mid
      } else {
        hi = mid
      }
    }

    const ndlEval = evaluateSurfaceAfterDirectAscent(lo, depthCfg)
    points.push({
      depthMeters: d,
      ndlMinutes: lo,
      isUnlimited: false,
      leadingCompartment: ndlEval.leadingCompartment,
      surfaceGfAtNdl: ndlEval.surfaceGf,
      bottomPpO2Bar,
    })
  }

  let deepestUnlimitedDepthMeters: number | null = null
  let shallowestFiniteDepthMeters: number | null = null

  for (const pt of points) {
    if (pt.isUnlimited) {
      deepestUnlimitedDepthMeters = pt.depthMeters
    } else if (shallowestFiniteDepthMeters === null) {
      shallowestFiniteDepthMeters = pt.depthMeters
    }
  }

  const mod14Meters = pressureToDepth(
    1.4 / normalizedBase.fO2,
    fullInput.surfacePressureBar,
    fullInput.barPerMeter,
  )
  const mod16Meters = pressureToDepth(
    1.6 / normalizedBase.fO2,
    fullInput.surfacePressureBar,
    fullInput.barPerMeter,
  )

  return {
    input: fullInput,
    points,
    deepestUnlimitedDepthMeters,
    shallowestFiniteDepthMeters,
    mod14Meters,
    mod16Meters,
  }
}

