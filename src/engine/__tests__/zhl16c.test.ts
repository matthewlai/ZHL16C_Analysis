import { describe, expect, it } from 'vitest'
import {
  ALVEOLAR_WATER_VAPOR_PRESSURE_BAR,
  SUBSURFACE_SURFACE_FN2,
  SURFACE_PRESSURE_STANDARD_BAR,
  WATER_DENSITY_PRESETS,
  ZHL16C_1B_COMPARTMENTS,
  ZHL16C_1_COMPARTMENTS,
} from '../constants'
import {
  calculateNdlCurve,
  calculateNdlMinutes,
  compartmentCeilingPressure,
  compartmentMValue,
  haldaneCompartment,
  planDive,
  roundUpToStopGrid,
  schreinerCompartment,
} from '../zhl16c'

describe('ZH-L16C compartment coefficients', () => {
  it('provides 16 compartments for both 1b (4.0 min) and 1 (5.0 min) variants', () => {
    expect(ZHL16C_1B_COMPARTMENTS).toHaveLength(16)
    expect(ZHL16C_1_COMPARTMENTS).toHaveLength(16)

    expect(ZHL16C_1B_COMPARTMENTS[0]).toMatchObject({
      index: 1,
      label: '1b',
      n2HalfTime: 4.0,
      n2A: 1.2599,
      n2B: 0.505,
    })

    expect(ZHL16C_1_COMPARTMENTS[0]).toMatchObject({
      index: 1,
      label: '1',
      n2HalfTime: 5.0,
      n2A: 1.1696,
      n2B: 0.5578,
    })

    // Compartments 2..16 must match identically between both variants
    for (let i = 1; i < 16; i++) {
      expect(ZHL16C_1B_COMPARTMENTS[i]).toEqual(ZHL16C_1_COMPARTMENTS[i])
    }
  })

  it('has strictly increasing N2 half-times from compartment 1 to 16', () => {
    for (let i = 1; i < ZHL16C_1B_COMPARTMENTS.length; i++) {
      expect(ZHL16C_1B_COMPARTMENTS[i].n2HalfTime).toBeGreaterThan(
        ZHL16C_1B_COMPARTMENTS[i - 1].n2HalfTime,
      )
      expect(ZHL16C_1B_COMPARTMENTS[i].n2B).toBeGreaterThan(
        ZHL16C_1B_COMPARTMENTS[i - 1].n2B,
      )
      expect(ZHL16C_1B_COMPARTMENTS[i].n2A).toBeLessThan(
        ZHL16C_1B_COMPARTMENTS[i - 1].n2A,
      )
    }
  })
})

describe('Haldane and Schreiner gas loading equations', () => {
  it('halves remaining gradient in exactly one half-time at constant depth', () => {
    const p0 = 0.75
    const pAlv = 3.15
    const afterOneHalfTime = haldaneCompartment(p0, pAlv, 8.0, 8.0)
    expect(afterOneHalfTime).toBeCloseTo(0.5 * (p0 + pAlv), 10)
  })

  it('matches DecoTengu analytical Schreiner unit test vectors (t_half=5.0 min)', () => {
    // Reference: gully/decotengu decotengu/tests/test_model.py
    // p0 = 3.0 bar, start P_amb = 4.0 bar, P_H2O = 0.0627 bar, t = 1.0 min, t_half = 5.0 min
    const p0 = 3.0
    const pAmb0 = 4.0
    const tHalf = 5.0
    const pH2O = ALVEOLAR_WATER_VAPOR_PRESSURE_BAR

    // Air (fN2 = 0.79), ascent r = -1.0 bar/min -> 2.961986 bar
    expect(schreinerCompartment(p0, pAmb0, -1.0, 0.79, 1.0, tHalf, pH2O)).toBeCloseTo(
      2.961986,
      5,
    )
    // Air (fN2 = 0.79), descent r = +1.0 bar/min -> 3.066611 bar
    expect(schreinerCompartment(p0, pAmb0, 1.0, 0.79, 1.0, tHalf, pH2O)).toBeCloseTo(
      3.066611,
      5,
    )
    // EAN32 (fN2 = 0.68), ascent r = -1.0 bar/min -> 2.913201 bar
    expect(schreinerCompartment(p0, pAmb0, -1.0, 0.68, 1.0, tHalf, pH2O)).toBeCloseTo(
      2.913201,
      5,
    )
    // EAN32 (fN2 = 0.68), descent r = +1.0 bar/min -> 3.003263 bar
    expect(schreinerCompartment(p0, pAmb0, 1.0, 0.68, 1.0, tHalf, pH2O)).toBeCloseTo(
      3.003263,
      5,
    )
  })

  it('matches fine-grained midpoint Riemann Haldane integration along a ramp', () => {
    const p0 = 0.7509
    const pStart = 1.01325
    const rate = 1.5 // bar/min
    const duration = 2.0 // min
    const fN2 = 0.68
    const tHalf = 12.5

    const exact = schreinerCompartment(p0, pStart, rate, fN2, duration, tHalf)

    let numeric = p0
    const steps = 4000
    const dt = duration / steps
    for (let i = 0; i < steps; i++) {
      const pAmbMid = pStart + rate * (i + 0.5) * dt
      const pAlvMid = (pAmbMid - ALVEOLAR_WATER_VAPOR_PRESSURE_BAR) * fN2
      numeric = haldaneCompartment(numeric, pAlvMid, dt, tHalf)
    }

    expect(exact).toBeCloseTo(numeric, 6)
  })
})

describe('Bühlmann M-values and Erik Baker Gradient Factor ceilings', () => {
  it('matches DecoTengu analytical ceiling pressure test vectors', () => {
    // Reference: gully/decotengu decotengu/tests/test_model.py
    // Compartment 1 (5.0 min): a = 1.1696, b = 0.5578, P_tissue = 3.0 bar
    const a = 1.1696
    const b = 0.5578
    expect(compartmentCeilingPressure(3.0, a, b, 0.3)).toBeCloseTo(2.140137, 6)
    expect(compartmentCeilingPressure(3.0, a, b, 1.0)).toBeCloseTo(1.020997, 6)
  })

  it('is the exact mathematical inverse of compartmentMValue', () => {
    for (const comp of ZHL16C_1B_COMPARTMENTS) {
      for (const gf of [0.2, 0.35, 0.7, 0.85, 1.0]) {
        const pAmb = 2.2
        const mVal = compartmentMValue(pAmb, comp.n2A, comp.n2B, gf)
        const pCeil = compartmentCeilingPressure(mVal, comp.n2A, comp.n2B, gf)
        expect(pCeil).toBeCloseTo(pAmb, 10)
      }
    }
  })

  it('rounds arbitrary ceiling depths to configurable stop grids', () => {
    expect(roundUpToStopGrid(0, 3, 3)).toBe(0)
    expect(roundUpToStopGrid(0.2, 3, 3)).toBe(3)
    expect(roundUpToStopGrid(3.0, 3, 3)).toBe(3)
    expect(roundUpToStopGrid(3.05, 3, 3)).toBe(6)

    // 6 m last stop with 3 m steps -> 6, 9, 12, 15...
    expect(roundUpToStopGrid(1.4, 3, 6)).toBe(6)
    expect(roundUpToStopGrid(6.0, 3, 6)).toBe(6)
    expect(roundUpToStopGrid(6.1, 3, 6)).toBe(9)
    expect(roundUpToStopGrid(10.8, 3, 6)).toBe(12)

    // 1 m step size with 3 m last stop -> 3, 4, 5, 6...
    expect(roundUpToStopGrid(3.2, 1, 3)).toBe(4)
  })
})

describe('Cross-validation against Subsurface, MultiDeco, Shearwater, and DecoTengu', () => {
  const freshBarPerM = WATER_DENSITY_PRESETS.fresh.barPerMeter
  const enBarPerM = WATER_DENSITY_PRESETS.en13319.barPerMeter
  const metricSaltBarPerM = WATER_DENSITY_PRESETS.salt_metric.barPerMeter

  it('Profile 1 (Subsurface / MultiDeco / Shearwater): Air 18 m for 30 min @ GF 100/100 -> NDL (0 stops)', () => {
    const plan = planDive({
      depthMeters: 18,
      bottomTimeMinutes: 30,
      o2Percent: 21,
      gfLowPercent: 100,
      gfHighPercent: 100,
      ascentRateMPerMin: 10,
      descentRateMPerMin: 20,
      decoStepSizeMeters: 3,
      lastStopDepthMeters: 6,
      barPerMeter: freshBarPerM,
    })

    expect(plan.isDecoRequired).toBe(false)
    expect(plan.decoStops).toHaveLength(0)
    expect(plan.totalDecoStopMinutes).toBe(0)
    // 30 min bottom + 1.8 min ascent = 31.8 min (~32 min rounded in Subsurface/Shearwater)
    expect(plan.totalRuntimeMinutes).toBeCloseTo(31.8, 4)
  })

  it('Profile 2 (Subsurface 6.0.5214 & Abysner Ref Plan 1): Air 20 m for 20 min @ GF 30/70, 5 m/min -> 0 stops, 24 min runtime', () => {
    const plan = planDive({
      depthMeters: 20,
      bottomTimeMinutes: 20,
      o2Percent: 21,
      gfLowPercent: 30,
      gfHighPercent: 70,
      ascentRateMPerMin: 5,
      descentRateMPerMin: 5,
      decoStepSizeMeters: 3,
      lastStopDepthMeters: 3,
      variant: 'ZHL16C_1',
      barPerMeter: freshBarPerM,
      surfaceFN2: SUBSURFACE_SURFACE_FN2,
    })

    expect(plan.isDecoRequired).toBe(false)
    expect(plan.decoStops).toHaveLength(0)
    expect(plan.descentDurationMinutes).toBeCloseTo(4.0, 6)
    expect(plan.flatBottomDurationMinutes).toBeCloseTo(16.0, 6)
    expect(plan.totalRuntimeMinutes).toBeCloseTo(24.0, 6)
  })

  it('Profile 3 (Subsurface & Dive Tools): Air 30 m for 20 min @ GF 50/85, last stop 6 m -> 6 m stop, ~27 min runtime', () => {
    const plan = planDive({
      depthMeters: 30,
      bottomTimeMinutes: 20,
      o2Percent: 21,
      gfLowPercent: 50,
      gfHighPercent: 85,
      ascentRateMPerMin: 10,
      descentRateMPerMin: 20,
      decoStepSizeMeters: 3,
      lastStopDepthMeters: 6,
      variant: 'ZHL16C_1',
      barPerMeter: freshBarPerM,
      surfaceFN2: SUBSURFACE_SURFACE_FN2,
    })

    expect(plan.isDecoRequired).toBe(true)
    expect(plan.firstStopDepthMeters).toBe(6)
    expect(plan.decoStops).toHaveLength(1)
    expect(plan.decoStops[0].depthMeters).toBe(6)
    expect(plan.decoStops[0].durationMinutes).toBeGreaterThanOrEqual(3)
    expect(plan.decoStops[0].durationMinutes).toBeLessThanOrEqual(5)
    expect(Math.round(plan.totalRuntimeMinutes)).toBeGreaterThanOrEqual(26)
    expect(Math.round(plan.totalRuntimeMinutes)).toBeLessThanOrEqual(28)
  })

  it('Profile 4 (Subsurface / MultiDeco / Shearwater): Air 30 m for 25 min @ GF 30/70, last stop 6 m -> 12 m first stop, 47-51 min runtime', () => {
    for (const variant of ['ZHL16C_1B', 'ZHL16C_1'] as const) {
      for (const gfAnchorMode of ['first_stop', 'continuous_ceiling'] as const) {
        const plan = planDive({
          depthMeters: 30,
          bottomTimeMinutes: 25,
          o2Percent: 21,
          gfLowPercent: 30,
          gfHighPercent: 70,
          ascentRateMPerMin: 10,
          descentRateMPerMin: 20,
          decoStepSizeMeters: 3,
          lastStopDepthMeters: 6,
          variant,
          gfAnchorMode,
          barPerMeter: freshBarPerM,
        })

        expect(plan.firstStopDepthMeters).toBe(12)
        expect(plan.decoStops.map((s) => s.depthMeters)).toEqual([12, 9, 6])
        // Subsurface=48 min, MultiDeco=50 min, Shearwater=53 min
        expect(plan.totalRuntimeMinutes).toBeGreaterThanOrEqual(46.5)
        expect(plan.totalRuntimeMinutes).toBeLessThanOrEqual(52)
      }
    }
  })

  it('Profile 5 (Subsurface 6.0.5576 & Abysner Ref Plan 9): Air 30 m for 30 min @ GF 85/85, 5 m/min -> single 3 m stop ~8 min, ~45 min runtime', () => {
    const plan = planDive({
      depthMeters: 30,
      bottomTimeMinutes: 30,
      o2Percent: 21,
      gfLowPercent: 85,
      gfHighPercent: 85,
      ascentRateMPerMin: 5,
      descentRateMPerMin: 5,
      decoStepSizeMeters: 3,
      lastStopDepthMeters: 3,
      variant: 'ZHL16C_1',
      barPerMeter: freshBarPerM,
      surfaceFN2: SUBSURFACE_SURFACE_FN2,
    })

    expect(plan.decoStops).toHaveLength(1)
    expect(plan.decoStops[0].depthMeters).toBe(3)
    expect(plan.decoStops[0].durationMinutes).toBeGreaterThanOrEqual(7)
    expect(plan.decoStops[0].durationMinutes).toBeLessThanOrEqual(9)
    expect(Math.round(plan.totalRuntimeMinutes)).toBeGreaterThanOrEqual(44)
    expect(Math.round(plan.totalRuntimeMinutes)).toBeLessThanOrEqual(46)
  })

  it('Profile 6 (GF Low sensitivity): deepens first stop as GF Low decreases on 40 m and 50 m Air dives', () => {
    const common = {
      o2Percent: 21,
      ascentRateMPerMin: 10,
      descentRateMPerMin: 20,
      decoStepSizeMeters: 3,
      lastStopDepthMeters: 3,
      barPerMeter: metricSaltBarPerM,
    }

    // Baker / MultiDeco first_stop mode
    const p40Gf40 = planDive({
      ...common,
      depthMeters: 40,
      bottomTimeMinutes: 20,
      gfLowPercent: 40,
      gfHighPercent: 70,
      gfAnchorMode: 'first_stop',
    })
    const p40Gf30 = planDive({
      ...common,
      depthMeters: 40,
      bottomTimeMinutes: 20,
      gfLowPercent: 30,
      gfHighPercent: 70,
      gfAnchorMode: 'first_stop',
    })
    expect(p40Gf40.firstStopDepthMeters).toBe(15)
    expect(p40Gf30.firstStopDepthMeters).toBe(18)

    // 50 m with 20 min at depth after 2.5 min descent (22.5 min runtime): GF 30/70 -> 24 m, GF 40/70 -> 21 m
    const p50Gf30 = planDive({
      ...common,
      depthMeters: 50,
      bottomTimeMinutes: 22.5,
      gfLowPercent: 30,
      gfHighPercent: 70,
      gfAnchorMode: 'first_stop',
    })
    const p50Gf40 = planDive({
      ...common,
      depthMeters: 50,
      bottomTimeMinutes: 22.5,
      gfLowPercent: 40,
      gfHighPercent: 70,
      gfAnchorMode: 'first_stop',
    })
    expect(p50Gf30.firstStopDepthMeters).toBe(24)
    expect(p50Gf40.firstStopDepthMeters).toBe(21)

    // Continuous ceiling mode also shifts deeper monotonically as GF Low drops
    const cont50Gf40 = planDive({
      ...common,
      depthMeters: 50,
      bottomTimeMinutes: 22.5,
      gfLowPercent: 40,
      gfHighPercent: 70,
      gfAnchorMode: 'continuous_ceiling',
    })
    const cont50Gf25 = planDive({
      ...common,
      depthMeters: 50,
      bottomTimeMinutes: 22.5,
      gfLowPercent: 25,
      gfHighPercent: 70,
      gfAnchorMode: 'continuous_ceiling',
    })
    expect(cont50Gf25.firstStopDepthMeters!).toBeGreaterThan(cont50Gf40.firstStopDepthMeters!)
  })

  it('keeps NDL completely invariant to GF Low while increasing NDL as GF High increases', () => {
    const base = {
      depthMeters: 24,
      bottomTimeMinutes: 20,
      o2Percent: 32,
      ascentRateMPerMin: 10,
      descentRateMPerMin: 20,
      decoStepSizeMeters: 3,
      lastStopDepthMeters: 3,
    }
    const ndlGf20_80 = calculateNdlMinutes({ ...base, gfLowPercent: 20, gfHighPercent: 80 })
    const ndlGf50_80 = calculateNdlMinutes({ ...base, gfLowPercent: 50, gfHighPercent: 80 })
    const ndlGf80_80 = calculateNdlMinutes({ ...base, gfLowPercent: 80, gfHighPercent: 80 })
    expect(ndlGf20_80).toBe(ndlGf50_80)
    expect(ndlGf50_80).toBe(ndlGf80_80)

    const ndlGf30_70 = calculateNdlMinutes({ ...base, gfLowPercent: 30, gfHighPercent: 70 })
    const ndlGf30_95 = calculateNdlMinutes({ ...base, gfLowPercent: 30, gfHighPercent: 95 })
    expect(ndlGf30_95!).toBeGreaterThan(ndlGf30_70!)
  })

  it('Profile 7 (DecoTengu last stop 6 m vs 3 m): Air 45 m for 25 min @ GF 30/85 lengthens deco when last stop is 6 m', () => {
    const base = {
      depthMeters: 45,
      bottomTimeMinutes: 25,
      o2Percent: 21,
      gfLowPercent: 30,
      gfHighPercent: 85,
      ascentRateMPerMin: 10,
      descentRateMPerMin: 20,
      decoStepSizeMeters: 3,
      barPerMeter: enBarPerM,
    }

    const stop3m = planDive({ ...base, lastStopDepthMeters: 3 })
    const stop6m = planDive({ ...base, lastStopDepthMeters: 6 })

    expect(stop3m.decoStops[stop3m.decoStops.length - 1].depthMeters).toBe(3)
    expect(stop6m.decoStops[stop6m.decoStops.length - 1].depthMeters).toBe(6)
    // Holding off-gassing at 6 m instead of 3 m has lower N2 gradient and significantly increases deco time
    expect(stop6m.totalDecoStopMinutes).toBeGreaterThan(stop3m.totalDecoStopMinutes + 4)
  })

  it('Profile 8 (NDL boundary): Air 30 m @ descent 10 m/min transitions cleanly at exact NDL minute', () => {
    const base = {
      depthMeters: 30,
      bottomTimeMinutes: 18,
      o2Percent: 21,
      gfLowPercent: 90,
      gfHighPercent: 90,
      ascentRateMPerMin: 10,
      descentRateMPerMin: 10,
      decoStepSizeMeters: 3,
      lastStopDepthMeters: 3,
      barPerMeter: enBarPerM,
    }

    const ndl90 = calculateNdlMinutes(base)
    expect(ndl90).toBe(18)

    const at18 = planDive({ ...base, bottomTimeMinutes: 18 })
    const at19 = planDive({ ...base, bottomTimeMinutes: 19 })
    expect(at18.decoStops).toHaveLength(0)
    expect(at19.decoStops.length).toBeGreaterThan(0)

    const ndl100 = calculateNdlMinutes({
      ...base,
      gfLowPercent: 100,
      gfHighPercent: 100,
    })
    expect(ndl100).toBe(21)
    expect(
      planDive({ ...base, gfLowPercent: 100, gfHighPercent: 100, bottomTimeMinutes: 21 }).decoStops,
    ).toHaveLength(0)
    expect(
      planDive({ ...base, gfLowPercent: 100, gfHighPercent: 100, bottomTimeMinutes: 22 }).decoStops
        .length,
    ).toBeGreaterThan(0)
  })
})

describe('Nitrox behavior, invariants, and edge cases', () => {
  it('never adds safety stops on NDL dives across recreational depths and mixes', () => {
    for (const [depth, time, o2] of [
      [12, 40, 21],
      [18, 35, 32],
      [25, 22, 32],
      [30, 15, 36],
    ]) {
      const plan = planDive({
        depthMeters: depth,
        bottomTimeMinutes: time,
        o2Percent: o2,
        gfLowPercent: 40,
        gfHighPercent: 85,
        ascentRateMPerMin: 10,
        descentRateMPerMin: 20,
        decoStepSizeMeters: 3,
        lastStopDepthMeters: 3,
      })
      expect(plan.isDecoRequired).toBe(false)
      expect(plan.decoStops).toEqual([])
      expect(plan.segments.every((s) => s.type !== 'deco_stop')).toBe(true)
    }
  })

  it('reduces mandatory deco obligation monotonically as Nitrox O2% increases', () => {
    const common = {
      depthMeters: 33,
      bottomTimeMinutes: 35,
      gfLowPercent: 35,
      gfHighPercent: 80,
      ascentRateMPerMin: 9,
      descentRateMPerMin: 18,
      decoStepSizeMeters: 3,
      lastStopDepthMeters: 3,
    }

    const air = planDive({ ...common, o2Percent: 21 })
    const ean32 = planDive({ ...common, o2Percent: 32 })
    const ean36 = planDive({ ...common, o2Percent: 36 })
    const o2Pure = planDive({ ...common, depthMeters: 6, bottomTimeMinutes: 120, o2Percent: 100 })

    expect(air.totalDecoStopMinutes).toBeGreaterThan(ean32.totalDecoStopMinutes)
    expect(ean32.totalDecoStopMinutes).toBeGreaterThan(ean36.totalDecoStopMinutes)
    expect(ean36.ndlMinutes!).toBeGreaterThan(ean32.ndlMinutes!)
    expect(ean32.ndlMinutes!).toBeGreaterThan(air.ndlMinutes!)

    expect(o2Pure.isUnlimitedNdl).toBe(true)
    expect(o2Pure.ndlMinutes).toBeNull()
    expect(o2Pure.decoStops).toHaveLength(0)
  })

  it('never violates the active GF ceiling during ascent or at surfacing', () => {
    const plan = planDive({
      depthMeters: 42,
      bottomTimeMinutes: 30,
      o2Percent: 28,
      gfLowPercent: 30,
      gfHighPercent: 75,
      ascentRateMPerMin: 10,
      descentRateMPerMin: 20,
      decoStepSizeMeters: 3,
      lastStopDepthMeters: 3,
    })

    expect(plan.isDecoRequired).toBe(true)
    expect(plan.surfaceGf).toBeLessThanOrEqual(0.75 + 1e-6)

    for (const sample of plan.samples) {
      if (sample.timeMinutes >= plan.effectiveBottomTimeMinutes) {
        expect(sample.depthMeters + 1e-3).toBeGreaterThanOrEqual(sample.ceilingDepthMeters)
      }
    }
  })

  it('computes accurate ppO2 and MOD values in metric', () => {
    const plan = planDive({
      depthMeters: 30,
      bottomTimeMinutes: 25,
      o2Percent: 32,
      gfLowPercent: 40,
      gfHighPercent: 85,
      ascentRateMPerMin: 10,
      descentRateMPerMin: 20,
      decoStepSizeMeters: 3,
      lastStopDepthMeters: 3,
      surfacePressureBar: SURFACE_PRESSURE_STANDARD_BAR,
      barPerMeter: 0.1,
    })

    // P_amb(30 m) = 1.01325 + 3.0 = 4.01325 bar -> ppO2 = 4.01325 * 0.32 = 1.28424 bar
    expect(plan.bottomPpO2Bar).toBeCloseTo(4.01325 * 0.32, 5)
    // MOD 1.4 bar = (1.4 / 0.32 - 1.01325) / 0.1 = 33.6175 m
    expect(plan.mod14Meters).toBeCloseTo((1.4 / 0.32 - SURFACE_PRESSURE_STANDARD_BAR) / 0.1, 5)
  })

  it('clamps effective bottom time cleanly if requested bottomTimeMinutes < descent time', () => {
    const plan = planDive({
      depthMeters: 40,
      bottomTimeMinutes: 1, // descent at 10 m/min takes 4 min
      o2Percent: 21,
      gfLowPercent: 30,
      gfHighPercent: 80,
      ascentRateMPerMin: 10,
      descentRateMPerMin: 10,
      decoStepSizeMeters: 3,
      lastStopDepthMeters: 3,
    })

    expect(plan.bottomTimeClampedToDescent).toBe(true)
    expect(plan.descentDurationMinutes).toBeCloseTo(4, 6)
    expect(plan.flatBottomDurationMinutes).toBeCloseTo(0, 6)
    expect(plan.effectiveBottomTimeMinutes).toBeCloseTo(4, 6)
  })

  it('validates out-of-range inputs with RangeError', () => {
    const valid = {
      depthMeters: 30,
      bottomTimeMinutes: 20,
      o2Percent: 32,
      gfLowPercent: 30,
      gfHighPercent: 80,
      ascentRateMPerMin: 10,
      descentRateMPerMin: 20,
      decoStepSizeMeters: 3,
      lastStopDepthMeters: 3,
    }
    expect(() => planDive({ ...valid, depthMeters: 0 })).toThrow(RangeError)
    expect(() => planDive({ ...valid, o2Percent: 18 })).toThrow(RangeError)
    expect(() => planDive({ ...valid, o2Percent: 101 })).toThrow(RangeError)
    expect(() => planDive({ ...valid, gfLowPercent: 0 })).toThrow(RangeError)
    expect(() => planDive({ ...valid, decoStepSizeMeters: -3 })).toThrow(RangeError)
  })
})

describe('NDL vs depth curve calculation', () => {
  it('matches point-wise calculateNdlMinutes and decreases monotonically with depth', () => {
    const curve = calculateNdlCurve({
      minDepthMeters: 6,
      maxDepthMeters: 48,
      depthStepMeters: 3,
      o2Percent: 21,
      gfHighPercent: 85,
      ascentRateMPerMin: 10,
      descentRateMPerMin: 20,
    })

    expect(curve.points.length).toBe(15)
    expect(curve.deepestUnlimitedDepthMeters).toBe(6)
    expect(curve.shallowestFiniteDepthMeters).toBe(9)

    let prevNdl = Infinity
    for (const pt of curve.points) {
      const single = calculateNdlMinutes({
        depthMeters: pt.depthMeters,
        bottomTimeMinutes: 10,
        o2Percent: 21,
        gfLowPercent: 30,
        gfHighPercent: 85,
        ascentRateMPerMin: 10,
        descentRateMPerMin: 20,
        decoStepSizeMeters: 3,
        lastStopDepthMeters: 3,
      })
      expect(pt.ndlMinutes).toBe(single)

      if (pt.ndlMinutes !== null) {
        expect(pt.ndlMinutes).toBeLessThanOrEqual(prevNdl)
        expect(pt.surfaceGfAtNdl).toBeLessThanOrEqual(0.85 + 1e-6)
        prevNdl = pt.ndlMinutes
      }
    }
  })

  it('increases NDL across all finite depths as GF High or O2% increases', () => {
    const gf70 = calculateNdlCurve({
      minDepthMeters: 12,
      maxDepthMeters: 42,
      depthStepMeters: 3,
      o2Percent: 21,
      gfHighPercent: 70,
      ascentRateMPerMin: 10,
      descentRateMPerMin: 20,
    })
    const gf100 = calculateNdlCurve({
      minDepthMeters: 12,
      maxDepthMeters: 42,
      depthStepMeters: 3,
      o2Percent: 21,
      gfHighPercent: 100,
      ascentRateMPerMin: 10,
      descentRateMPerMin: 20,
    })
    const ean32Gf70 = calculateNdlCurve({
      minDepthMeters: 12,
      maxDepthMeters: 42,
      depthStepMeters: 3,
      o2Percent: 32,
      gfHighPercent: 70,
      ascentRateMPerMin: 10,
      descentRateMPerMin: 20,
    })

    for (let i = 0; i < gf70.points.length; i++) {
      const a = gf70.points[i].ndlMinutes
      const b = gf100.points[i].ndlMinutes
      const c = ean32Gf70.points[i].ndlMinutes
      if (a !== null && b !== null) expect(b).toBeGreaterThanOrEqual(a)
      if (a !== null && c !== null) expect(c).toBeGreaterThanOrEqual(a)
    }
  })

  it('validates NDL curve depth range inputs', () => {
    const base = {
      minDepthMeters: 10,
      maxDepthMeters: 40,
      depthStepMeters: 1,
      o2Percent: 32,
      gfHighPercent: 85,
      ascentRateMPerMin: 10,
      descentRateMPerMin: 20,
    }
    expect(() => calculateNdlCurve({ ...base, minDepthMeters: 0 })).toThrow(RangeError)
    expect(() => calculateNdlCurve({ ...base, minDepthMeters: 30, maxDepthMeters: 20 })).toThrow(
      RangeError,
    )
    expect(() => calculateNdlCurve({ ...base, depthStepMeters: 0 })).toThrow(RangeError)
  })
})

