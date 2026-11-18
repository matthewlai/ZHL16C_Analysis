/**
 * Bühlmann ZH-L16C compartment coefficients and metric physical constants.
 *
 * Historical note on Compartment 1 vs. 1b:
 * In A. A. Bühlmann's Tauchmedizin (4th ed., 1995 / 5th ed., 2002), the ZH-L16
 * table lists 17 rows: "1" (N2 half-time 5.0 min) and "1b" (N2 half-time 4.0 min),
 * followed by "2" through "16". Because 16-compartment dive computers and planners
 * choose either 1 or 1b for slot 1:
 *  - ZHL16C_1B (4.0 min): Used by OSTC/HeinrichsWeikamp, DecoTengu, MultiDeco, Shearwater.
 *  - ZHL16C_1  (5.0 min): Used by Subsurface, MV-Plan, Abysner, and Erik Baker's tables.
 * Compartments 2–16 are identical across all established ZH-L16C implementations.
 */

export type Zhl16Variant = 'ZHL16C_1B' | 'ZHL16C_1'

export interface CompartmentCoefficients {
  /** 1-based compartment index (1..16) */
  readonly index: number
  /** Bühlmann label ('1b' or '1', then '2'..'16') */
  readonly label: string
  /** Nitrogen half-time in minutes */
  readonly n2HalfTime: number
  /** ZH-L16C Nitrogen 'a' intercept parameter (bar) */
  readonly n2A: number
  /** ZH-L16C Nitrogen 'b' slope parameter (dimensionless) */
  readonly n2B: number
  /** Helium half-time in minutes (included for model completeness) */
  readonly heHalfTime: number
  /** ZH-L16C Helium 'a' intercept parameter (bar) */
  readonly heA: number
  /** ZH-L16C Helium 'b' slope parameter (dimensionless) */
  readonly heB: number
}

const COMPARTMENTS_2_TO_16: readonly Omit<CompartmentCoefficients, 'index'>[] = [
  { label: '2', n2HalfTime: 8.0, n2A: 1.0000, n2B: 0.6514, heHalfTime: 3.02, heA: 1.3830, heB: 0.5747 },
  { label: '3', n2HalfTime: 12.5, n2A: 0.8618, n2B: 0.7222, heHalfTime: 4.72, heA: 1.1919, heB: 0.6527 },
  { label: '4', n2HalfTime: 18.5, n2A: 0.7562, n2B: 0.7825, heHalfTime: 6.99, heA: 1.0458, heB: 0.7223 },
  { label: '5', n2HalfTime: 27.0, n2A: 0.6200, n2B: 0.8126, heHalfTime: 10.21, heA: 0.9220, heB: 0.7582 },
  { label: '6', n2HalfTime: 38.3, n2A: 0.5043, n2B: 0.8434, heHalfTime: 14.48, heA: 0.8205, heB: 0.7957 },
  { label: '7', n2HalfTime: 54.3, n2A: 0.4410, n2B: 0.8693, heHalfTime: 20.53, heA: 0.7305, heB: 0.8279 },
  { label: '8', n2HalfTime: 77.0, n2A: 0.4000, n2B: 0.8910, heHalfTime: 29.11, heA: 0.6502, heB: 0.8553 },
  { label: '9', n2HalfTime: 109.0, n2A: 0.3750, n2B: 0.9092, heHalfTime: 41.20, heA: 0.5950, heB: 0.8757 },
  { label: '10', n2HalfTime: 146.0, n2A: 0.3500, n2B: 0.9222, heHalfTime: 55.19, heA: 0.5545, heB: 0.8903 },
  { label: '11', n2HalfTime: 187.0, n2A: 0.3295, n2B: 0.9319, heHalfTime: 70.69, heA: 0.5333, heB: 0.8997 },
  { label: '12', n2HalfTime: 239.0, n2A: 0.3065, n2B: 0.9403, heHalfTime: 90.34, heA: 0.5189, heB: 0.9073 },
  { label: '13', n2HalfTime: 305.0, n2A: 0.2835, n2B: 0.9477, heHalfTime: 115.29, heA: 0.5181, heB: 0.9122 },
  { label: '14', n2HalfTime: 390.0, n2A: 0.2610, n2B: 0.9544, heHalfTime: 147.42, heA: 0.5176, heB: 0.9171 },
  { label: '15', n2HalfTime: 498.0, n2A: 0.2480, n2B: 0.9602, heHalfTime: 188.24, heA: 0.5172, heB: 0.9217 },
  { label: '16', n2HalfTime: 635.0, n2A: 0.2327, n2B: 0.9653, heHalfTime: 240.03, heA: 0.5119, heB: 0.9267 },
]

const COMPARTMENT_1B: CompartmentCoefficients = {
  index: 1,
  label: '1b',
  n2HalfTime: 4.0,
  n2A: 1.2599,
  n2B: 0.5050,
  heHalfTime: 1.51,
  heA: 1.7424,
  heB: 0.4245,
}

const COMPARTMENT_1: CompartmentCoefficients = {
  index: 1,
  label: '1',
  n2HalfTime: 5.0,
  n2A: 1.1696,
  n2B: 0.5578,
  heHalfTime: 1.88,
  heA: 1.6189,
  heB: 0.4770,
}

export const ZHL16C_1B_COMPARTMENTS: readonly CompartmentCoefficients[] = [
  COMPARTMENT_1B,
  ...COMPARTMENTS_2_TO_16.map((c, idx) => ({ index: idx + 2, ...c })),
]

export const ZHL16C_1_COMPARTMENTS: readonly CompartmentCoefficients[] = [
  COMPARTMENT_1,
  ...COMPARTMENTS_2_TO_16.map((c, idx) => ({ index: idx + 2, ...c })),
]

export function getCompartments(variant: Zhl16Variant = 'ZHL16C_1B'): readonly CompartmentCoefficients[] {
  return variant === 'ZHL16C_1' ? ZHL16C_1_COMPARTMENTS : ZHL16C_1B_COMPARTMENTS
}

/** Standard sea-level atmospheric pressure (1 atm = 1.01325 bar) */
export const SURFACE_PRESSURE_STANDARD_BAR = 1.01325

/** Bühlmann alveolar water vapor pressure at 37 °C with RQ = 1.0 (bar) */
export const ALVEOLAR_WATER_VAPOR_PRESSURE_BAR = 0.0627

/** Standard dry air inert gas fraction (1.0 - 0.21 O2, lumping Ar with N2) */
export const STANDARD_AIR_FN2 = 0.79

/** Subsurface surface air N2 fraction excluding Argon */
export const SUBSURFACE_SURFACE_FN2 = 0.781

export type WaterDensityId = 'salt_metric' | 'en13319' | 'fresh' | 'salt_subsurface'

export interface WaterDensityPreset {
  readonly id: WaterDensityId
  readonly label: string
  readonly barPerMeter: number
  readonly description: string
}

export const WATER_DENSITY_PRESETS: Record<WaterDensityId, WaterDensityPreset> = {
  salt_metric: {
    id: 'salt_metric',
    label: 'Saltwater (0.1000 bar/m)',
    barPerMeter: 0.1,
    description: 'Standard metric seawater convention (10 m = 1.0 bar)',
  },
  en13319: {
    id: 'en13319',
    label: 'EN 13319 (0.09985 bar/m)',
    barPerMeter: 0.09985,
    description: 'European dive computer standard (~1019.7 kg/m³)',
  },
  fresh: {
    id: 'fresh',
    label: 'Freshwater (0.0981 bar/m)',
    barPerMeter: 0.0980665,
    description: 'Pure freshwater at 1000 kg/m³ and standard gravity',
  },
  salt_subsurface: {
    id: 'salt_subsurface',
    label: 'Seawater 1030 kg/m³ (0.1010 bar/m)',
    barPerMeter: 0.101043,
    description: 'Subsurface default seawater density (1030 kg/m³)',
  },
}
