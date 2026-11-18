import { useMemo, useRef, useState } from 'react'
import { WATER_DENSITY_PRESETS, getCompartments } from '../engine/constants'
import type { WaterDensityId, Zhl16Variant } from '../engine/constants'
import { calculateNdlCurve } from '../engine/zhl16c'
import type { NdlCurvePoint } from '../engine/zhl16c'

interface NdlCurveViewProps {
  readonly o2Percent: number
  readonly onChangeO2Percent: (value: number) => void
  readonly gfHighPercent: number
  readonly onChangeGfHighPercent: (value: number) => void
  readonly ascentRateMPerMin: number
  readonly onChangeAscentRateMPerMin: (value: number) => void
  readonly descentRateMPerMin: number
  readonly onChangeDescentRateMPerMin: (value: number) => void
  readonly variant: Zhl16Variant
  readonly onChangeVariant: (value: Zhl16Variant) => void
  readonly waterDensityId: WaterDensityId
  readonly onChangeWaterDensityId: (value: WaterDensityId) => void
  readonly onInspectInProfilePlanner: (depthMeters: number, bottomTimeMinutes: number) => void
}

const GAS_PRESETS = [
  { label: 'Air 21%', o2: 21 },
  { label: 'EAN32', o2: 32 },
  { label: 'EAN36', o2: 36 },
  { label: 'EAN40', o2: 40 },
  { label: 'EAN50', o2: 50 },
] as const

const GF_HIGH_PRESETS = [70, 80, 85, 90, 100] as const
const Y_AXIS_CAPS = [90, 120, 180, 240] as const

const SVG_WIDTH = 800
const SVG_HEIGHT = 350
const PAD_LEFT = 54
const PAD_RIGHT = 24
const PAD_TOP = 24
const PAD_BOTTOM = 42
const PLOT_W = SVG_WIDTH - PAD_LEFT - PAD_RIGHT
const PLOT_H = SVG_HEIGHT - PAD_TOP - PAD_BOTTOM

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function chooseTickStep(span: number, targetCount: number): number {
  const raw = span / Math.max(1, targetCount)
  const niceSteps = [1, 2, 3, 5, 6, 10, 15, 20, 30, 40, 50, 60]
  for (const s of niceSteps) {
    if (s >= raw) return s
  }
  return Math.ceil(raw / 50) * 50
}

function toChartX(depth: number, minD: number, maxD: number): number {
  const span = Math.max(1, maxD - minD)
  return PAD_LEFT + ((depth - minD) / span) * PLOT_W
}

function toChartY(ndlMinutes: number | null, maxNdlAxis: number): number {
  const clamped = ndlMinutes === null ? maxNdlAxis : Math.min(maxNdlAxis, Math.max(0, ndlMinutes))
  return PAD_TOP + (1 - clamped / maxNdlAxis) * PLOT_H
}

function buildCurvePath(
  points: readonly NdlCurvePoint[],
  minD: number,
  maxD: number,
  maxNdlAxis: number,
): string {
  const finiteOrCapped = points.filter((p) => !p.isUnlimited)
  if (finiteOrCapped.length === 0) return ''

  // If the previous depth is unlimited, connect smoothly from the top ceiling at that depth
  const firstFiniteIdx = points.findIndex((p) => !p.isUnlimited)
  const startIdx = firstFiniteIdx > 0 ? firstFiniteIdx - 1 : firstFiniteIdx
  const slice = points.slice(startIdx)

  const coords = slice.map(
    (p) =>
      `${toChartX(p.depthMeters, minD, maxD).toFixed(2)},${toChartY(p.ndlMinutes, maxNdlAxis).toFixed(2)}`,
  )
  return `M ${coords.join(' L ')}`
}

function buildAreaPath(
  points: readonly NdlCurvePoint[],
  minD: number,
  maxD: number,
  maxNdlAxis: number,
): string {
  const line = buildCurvePath(points, minD, maxD, maxNdlAxis)
  if (!line) return ''
  const firstFiniteIdx = points.findIndex((p) => !p.isUnlimited)
  const startIdx = firstFiniteIdx > 0 ? firstFiniteIdx - 1 : firstFiniteIdx
  const firstX = toChartX(points[startIdx].depthMeters, minD, maxD).toFixed(2)
  const lastX = toChartX(points[points.length - 1].depthMeters, minD, maxD).toFixed(2)
  const baseY = toChartY(0, maxNdlAxis).toFixed(2)
  return `${line} L ${lastX},${baseY} L ${firstX},${baseY} Z`
}

function formatMixLabel(o2Percent: number): string {
  if (o2Percent === 21) return 'Air (21% O₂)'
  if (o2Percent === 100) return 'Pure O₂ (100%)'
  return `EAN${o2Percent} (${o2Percent}% O₂)`
}

function formatNdlValue(ndlMinutes: number | null): string {
  return ndlMinutes === null ? 'Unlimited' : `${ndlMinutes} min`
}

export function NdlCurveView({
  o2Percent,
  onChangeO2Percent,
  gfHighPercent,
  onChangeGfHighPercent,
  ascentRateMPerMin,
  onChangeAscentRateMPerMin,
  descentRateMPerMin,
  onChangeDescentRateMPerMin,
  variant,
  onChangeVariant,
  waterDensityId,
  onChangeWaterDensityId,
  onInspectInProfilePlanner,
}: NdlCurveViewProps) {
  const [minDepthMeters, setMinDepthMeters] = useState<number>(9)
  const [maxDepthMeters, setMaxDepthMeters] = useState<number>(45)
  const [depthStepMeters, setDepthStepMeters] = useState<number>(1)
  const [yAxisCapMinutes, setYAxisCapMinutes] = useState<number>(120)
  const [showGf100Overlay, setShowGf100Overlay] = useState<boolean>(true)
  const [showAirBaseline, setShowAirBaseline] = useState<boolean>(false)
  const [hoveredDepth, setHoveredDepth] = useState<number | null>(null)

  const svgRef = useRef<SVGSVGElement | null>(null)
  const barPerMeter = WATER_DENSITY_PRESETS[waterDensityId].barPerMeter
  const compartments = getCompartments(variant)

  const effectiveMaxDepth = Math.max(minDepthMeters + depthStepMeters, maxDepthMeters)

  const primaryCurve = useMemo(
    () =>
      calculateNdlCurve({
        minDepthMeters,
        maxDepthMeters: effectiveMaxDepth,
        depthStepMeters,
        o2Percent,
        gfHighPercent,
        ascentRateMPerMin,
        descentRateMPerMin,
        variant,
        barPerMeter,
      }),
    [
      minDepthMeters,
      effectiveMaxDepth,
      depthStepMeters,
      o2Percent,
      gfHighPercent,
      ascentRateMPerMin,
      descentRateMPerMin,
      variant,
      barPerMeter,
    ],
  )

  const gf100Curve = useMemo(() => {
    if (!showGf100Overlay || gfHighPercent === 100) return null
    return calculateNdlCurve({
      minDepthMeters,
      maxDepthMeters: effectiveMaxDepth,
      depthStepMeters,
      o2Percent,
      gfHighPercent: 100,
      ascentRateMPerMin,
      descentRateMPerMin,
      variant,
      barPerMeter,
    })
  }, [
    showGf100Overlay,
    gfHighPercent,
    minDepthMeters,
    effectiveMaxDepth,
    depthStepMeters,
    o2Percent,
    ascentRateMPerMin,
    descentRateMPerMin,
    variant,
    barPerMeter,
  ])

  const airBaselineCurve = useMemo(() => {
    if (!showAirBaseline || o2Percent === 21) return null
    return calculateNdlCurve({
      minDepthMeters,
      maxDepthMeters: effectiveMaxDepth,
      depthStepMeters,
      o2Percent: 21,
      gfHighPercent,
      ascentRateMPerMin,
      descentRateMPerMin,
      variant,
      barPerMeter,
    })
  }, [
    showAirBaseline,
    o2Percent,
    minDepthMeters,
    effectiveMaxDepth,
    depthStepMeters,
    gfHighPercent,
    ascentRateMPerMin,
    descentRateMPerMin,
    variant,
    barPerMeter,
  ])

  const depthTicks = useMemo(() => {
    const step = chooseTickStep(effectiveMaxDepth - minDepthMeters, 8)
    const firstTick = Math.ceil(minDepthMeters / step) * step
    const ticks: number[] = []
    for (let d = firstTick; d <= effectiveMaxDepth + 1e-6; d += step) {
      ticks.push(d)
    }
    return ticks
  }, [minDepthMeters, effectiveMaxDepth])

  const yTicks = useMemo(() => {
    const step = chooseTickStep(yAxisCapMinutes, 6)
    const ticks: number[] = []
    for (let m = 0; m <= yAxisCapMinutes + 1e-6; m += step) {
      ticks.push(m)
    }
    return ticks
  }, [yAxisCapMinutes])

  const primaryLinePath = useMemo(
    () => buildCurvePath(primaryCurve.points, minDepthMeters, effectiveMaxDepth, yAxisCapMinutes),
    [primaryCurve.points, minDepthMeters, effectiveMaxDepth, yAxisCapMinutes],
  )
  const primaryAreaPath = useMemo(
    () => buildAreaPath(primaryCurve.points, minDepthMeters, effectiveMaxDepth, yAxisCapMinutes),
    [primaryCurve.points, minDepthMeters, effectiveMaxDepth, yAxisCapMinutes],
  )
  const gf100LinePath = useMemo(
    () =>
      gf100Curve
        ? buildCurvePath(gf100Curve.points, minDepthMeters, effectiveMaxDepth, yAxisCapMinutes)
        : '',
    [gf100Curve, minDepthMeters, effectiveMaxDepth, yAxisCapMinutes],
  )
  const airLinePath = useMemo(
    () =>
      airBaselineCurve
        ? buildCurvePath(
            airBaselineCurve.points,
            minDepthMeters,
            effectiveMaxDepth,
            yAxisCapMinutes,
          )
        : '',
    [airBaselineCurve, minDepthMeters, effectiveMaxDepth, yAxisCapMinutes],
  )

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const el = svgRef.current
    if (!el || primaryCurve.points.length === 0) return
    const rect = el.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * SVG_WIDTH
    const clampedX = Math.max(PAD_LEFT, Math.min(PAD_LEFT + PLOT_W, svgX))
    const targetDepth =
      minDepthMeters +
      ((clampedX - PAD_LEFT) / PLOT_W) * Math.max(1, effectiveMaxDepth - minDepthMeters)

    let nearest = primaryCurve.points[0]
    let minDiff = Math.abs(nearest.depthMeters - targetDepth)
    for (const pt of primaryCurve.points) {
      const diff = Math.abs(pt.depthMeters - targetDepth)
      if (diff < minDiff) {
        minDiff = diff
        nearest = pt
      }
    }
    setHoveredDepth(nearest.depthMeters)
  }

  const defaultInspectPoint =
    primaryCurve.points.find((p) => p.depthMeters === 18) ??
    primaryCurve.points[Math.floor(primaryCurve.points.length / 2)] ??
    primaryCurve.points[0]

  const activePoint =
    (hoveredDepth !== null
      ? primaryCurve.points.find((p) => p.depthMeters === hoveredDepth)
      : undefined) ?? defaultInspectPoint

  const activeGf100Point = gf100Curve?.points.find(
    (p) => p.depthMeters === activePoint?.depthMeters,
  )
  const activeAirPoint = airBaselineCurve?.points.find(
    (p) => p.depthMeters === activePoint?.depthMeters,
  )

  const pointAt18 = primaryCurve.points.find((p) => Math.abs(p.depthMeters - 18) < 1e-6)
  const pointAt30 = primaryCurve.points.find((p) => Math.abs(p.depthMeters - 30) < 1e-6)

  const mod14InRange =
    primaryCurve.mod14Meters >= minDepthMeters &&
    primaryCurve.mod14Meters <= effectiveMaxDepth

  const tableRows = useMemo(() => {
    if (depthStepMeters >= 2 || primaryCurve.points.length <= 20) {
      return primaryCurve.points
    }
    return primaryCurve.points.filter(
      (p) =>
        p.depthMeters === minDepthMeters ||
        p.depthMeters === effectiveMaxDepth ||
        Math.round(p.depthMeters) % 3 === 0,
    )
  }, [primaryCurve.points, depthStepMeters, minDepthMeters, effectiveMaxDepth])

  const unlimitedZoneEndX =
    primaryCurve.deepestUnlimitedDepthMeters !== null
      ? toChartX(primaryCurve.deepestUnlimitedDepthMeters, minDepthMeters, effectiveMaxDepth)
      : null

  return (
    <div className="planner-workspace" id="ndl-curve-workspace">
      {/* Sidebar Controls */}
      <aside className="controls-panel" id="ndl-controls" aria-label="NDL Curve Parameters">
        <div className="control-group">
          <div className="group-heading-row">
            <h2 className="group-heading">Gradient Factor High</h2>
            <span className="field-meta">GF High {gfHighPercent}%</span>
          </div>

          <div className="field-block">
            <div className="field-header">
              <label className="field-label" htmlFor="ndl-input-gf-high">
                GF High
              </label>
              <span className="field-meta">Surfacing M-value limit</span>
            </div>
            <div className="slider-number-row">
              <input
                id="ndl-slider-gf-high"
                className="range-input"
                type="range"
                min={30}
                max={100}
                step={5}
                value={gfHighPercent}
                onChange={(e) => onChangeGfHighPercent(Number(e.target.value))}
              />
              <div className="number-unit-wrap">
                <input
                  id="ndl-input-gf-high"
                  className="number-input"
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={gfHighPercent}
                  onChange={(e) =>
                    onChangeGfHighPercent(
                      clampNumber(Number(e.target.value), 1, 100, gfHighPercent),
                    )
                  }
                />
                <span className="unit-suffix">%</span>
              </div>
            </div>
          </div>

          <div className="preset-row" role="group" aria-label="GF High Presets">
            {GF_HIGH_PRESETS.map((gf) => (
              <button
                key={gf}
                id={`ndl-preset-gf-${gf}`}
                type="button"
                className={`preset-btn${gfHighPercent === gf ? ' is-active' : ''}`}
                onClick={() => onChangeGfHighPercent(gf)}
              >
                {gf}%
              </button>
            ))}
          </div>

          <p className="field-help">
            NDL depends exclusively on <strong>GF High</strong>; GF Low only governs stop
            depth once mandatory decompression begins.
          </p>
        </div>

        <div className="control-group">
          <div className="group-heading-row">
            <h2 className="group-heading">Breathing Mix</h2>
            <span className="field-meta">{formatMixLabel(o2Percent)}</span>
          </div>

          <div className="field-block">
            <div className="field-header">
              <label className="field-label" htmlFor="ndl-input-o2">
                Nitrox O₂
              </label>
              <span className="field-meta">{100 - o2Percent}% N₂</span>
            </div>
            <div className="slider-number-row">
              <input
                id="ndl-slider-o2"
                className="range-input"
                type="range"
                min={21}
                max={100}
                step={1}
                value={o2Percent}
                onChange={(e) => onChangeO2Percent(Number(e.target.value))}
              />
              <div className="number-unit-wrap">
                <input
                  id="ndl-input-o2"
                  className="number-input"
                  type="number"
                  min={21}
                  max={100}
                  step={1}
                  value={o2Percent}
                  onChange={(e) =>
                    onChangeO2Percent(clampNumber(Number(e.target.value), 21, 100, o2Percent))
                  }
                />
                <span className="unit-suffix">%</span>
              </div>
            </div>
            <div className="preset-row" role="group" aria-label="Gas Mix Presets">
              {GAS_PRESETS.map((preset) => (
                <button
                  key={preset.o2}
                  id={`ndl-preset-gas-${preset.o2}`}
                  type="button"
                  className={`preset-btn${o2Percent === preset.o2 ? ' is-active' : ''}`}
                  onClick={() => onChangeO2Percent(preset.o2)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="control-group">
          <div className="group-heading-row">
            <h2 className="group-heading">Depth Range &amp; Rates</h2>
            <span className="field-meta">Metric</span>
          </div>

          <div className="compact-grid-2">
            <div className="field-block">
              <label className="field-label" htmlFor="ndl-input-min-depth">
                Min Depth
              </label>
              <div className="number-unit-wrap">
                <input
                  id="ndl-input-min-depth"
                  className="number-input"
                  type="number"
                  min={3}
                  max={40}
                  step={1}
                  value={minDepthMeters}
                  onChange={(e) => {
                    const next = clampNumber(Number(e.target.value), 3, 40, minDepthMeters)
                    setMinDepthMeters(next)
                    if (next >= maxDepthMeters) setMaxDepthMeters(next + 10)
                  }}
                />
                <span className="unit-suffix">m</span>
              </div>
            </div>

            <div className="field-block">
              <label className="field-label" htmlFor="ndl-input-max-depth">
                Max Depth
              </label>
              <div className="number-unit-wrap">
                <input
                  id="ndl-input-max-depth"
                  className="number-input"
                  type="number"
                  min={minDepthMeters + 3}
                  max={70}
                  step={1}
                  value={maxDepthMeters}
                  onChange={(e) =>
                    setMaxDepthMeters(
                      clampNumber(Number(e.target.value), minDepthMeters + 3, 70, maxDepthMeters),
                    )
                  }
                />
                <span className="unit-suffix">m</span>
              </div>
            </div>

            <div className="field-block">
              <label className="field-label" htmlFor="ndl-input-ascent-rate">
                Ascent Rate
              </label>
              <div className="number-unit-wrap">
                <input
                  id="ndl-input-ascent-rate"
                  className="number-input"
                  type="number"
                  min={1}
                  max={30}
                  step={1}
                  value={ascentRateMPerMin}
                  onChange={(e) =>
                    onChangeAscentRateMPerMin(
                      clampNumber(Number(e.target.value), 1, 60, ascentRateMPerMin),
                    )
                  }
                />
                <span className="unit-suffix">m/min</span>
              </div>
            </div>

            <div className="field-block">
              <label className="field-label" htmlFor="ndl-input-descent-rate">
                Descent Rate
              </label>
              <div className="number-unit-wrap">
                <input
                  id="ndl-input-descent-rate"
                  className="number-input"
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={descentRateMPerMin}
                  onChange={(e) =>
                    onChangeDescentRateMPerMin(
                      clampNumber(Number(e.target.value), 1, 60, descentRateMPerMin),
                    )
                  }
                />
                <span className="unit-suffix">m/min</span>
              </div>
            </div>
          </div>

          <div className="field-block">
            <label className="field-label" htmlFor="ndl-select-step">
              Depth Sampling Increment
            </label>
            <select
              id="ndl-select-step"
              className="select-input"
              value={depthStepMeters}
              onChange={(e) => setDepthStepMeters(Number(e.target.value))}
            >
              <option value={1}>1 m resolution (smooth curve)</option>
              <option value={2}>2 m resolution</option>
              <option value={3}>3 m resolution (classic table grid)</option>
            </select>
          </div>

          <div className="checkbox-stack">
            <label className="checkbox-row" htmlFor="ndl-checkbox-gf100">
              <input
                id="ndl-checkbox-gf100"
                type="checkbox"
                checked={showGf100Overlay}
                onChange={(e) => setShowGf100Overlay(e.target.checked)}
                disabled={gfHighPercent === 100}
              />
              <span>Compare against GF High 100% (unscaled M-value)</span>
            </label>

            <label className="checkbox-row" htmlFor="ndl-checkbox-air">
              <input
                id="ndl-checkbox-air"
                type="checkbox"
                checked={showAirBaseline}
                onChange={(e) => setShowAirBaseline(e.target.checked)}
                disabled={o2Percent === 21}
              />
              <span>Compare against Air (21% O₂) at GF {gfHighPercent}%</span>
            </label>
          </div>
        </div>

        <details className="advanced-details" id="ndl-advanced-settings">
          <summary className="advanced-summary">Model Variants &amp; Physical Constants</summary>
          <div className="advanced-body">
            <div className="field-block">
              <label className="field-label" htmlFor="ndl-select-variant">
                Compartment 1 Half-Time Set
              </label>
              <select
                id="ndl-select-variant"
                className="select-input"
                value={variant}
                onChange={(e) => onChangeVariant(e.target.value as Zhl16Variant)}
              >
                <option value="ZHL16C_1B">
                  1b — 4.0 min N₂ (OSTC / MultiDeco / Shearwater)
                </option>
                <option value="ZHL16C_1">1 — 5.0 min N₂ (Subsurface / MV-Plan)</option>
              </select>
            </div>

            <div className="field-block">
              <label className="field-label" htmlFor="ndl-select-water-density">
                Hydrostatic Water Conversion
              </label>
              <select
                id="ndl-select-water-density"
                className="select-input"
                value={waterDensityId}
                onChange={(e) => onChangeWaterDensityId(e.target.value as WaterDensityId)}
              >
                {Object.values(WATER_DENSITY_PRESETS).map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </details>
      </aside>

      {/* Main Plot & Table Column */}
      <div className="results-column">
        <section
          className="metrics-strip"
          id="ndl-summary-metrics"
          aria-label="NDL Curve Key Points"
        >
          <div className="metric-cell">
            <span className="metric-label">Active Envelope</span>
            <span className="metric-value" id="ndl-metric-gf">
              GF High {gfHighPercent}%
            </span>
            <span className="metric-sub">{formatMixLabel(o2Percent)}</span>
          </div>

          <div className="metric-cell">
            <span className="metric-label">Unlimited NDL</span>
            <span className="metric-value" id="ndl-metric-unlimited">
              {primaryCurve.deepestUnlimitedDepthMeters !== null
                ? `≤ ${primaryCurve.deepestUnlimitedDepthMeters} m`
                : `< ${minDepthMeters} m`}
            </span>
            <span className="metric-sub">Never hits GF High at surface</span>
          </div>

          <div className="metric-cell">
            <span className="metric-label">NDL at 18 m</span>
            <span className="metric-value" id="ndl-metric-18m">
              {pointAt18 ? formatNdlValue(pointAt18.ndlMinutes) : '—'}
            </span>
            <span className="metric-sub">
              {pointAt18 ? `Comp #${pointAt18.leadingCompartment}` : 'Outside depth range'}
            </span>
          </div>

          <div className="metric-cell">
            <span className="metric-label">NDL at 30 m</span>
            <span className="metric-value" id="ndl-metric-30m">
              {pointAt30 ? formatNdlValue(pointAt30.ndlMinutes) : '—'}
            </span>
            <span className="metric-sub">
              {pointAt30 ? `Comp #${pointAt30.leadingCompartment}` : 'Outside depth range'}
            </span>
          </div>

          <div className="metric-cell">
            <span className="metric-label">MOD (1.4 bar)</span>
            <span className="metric-value" id="ndl-metric-mod">
              {primaryCurve.mod14Meters.toFixed(1)} m
            </span>
            <span className="metric-sub">1.6 bar: {primaryCurve.mod16Meters.toFixed(1)} m</span>
          </div>
        </section>

        <section
          className="surface-panel"
          id="ndl-chart-panel"
          aria-labelledby="ndl-chart-heading"
        >
          <div className="panel-header">
            <div>
              <h2 className="panel-title" id="ndl-chart-heading">
                No-Decompression Limit (NDL) vs. Depth
              </h2>
            </div>

            <div className="chart-header-controls">
              <div className="preset-row" role="group" aria-label="Y-Axis Scale Max Minutes">
                <span className="field-meta">Max Y:</span>
                {Y_AXIS_CAPS.map((cap) => (
                  <button
                    key={cap}
                    id={`ndl-yaxis-cap-${cap}`}
                    type="button"
                    className={`preset-btn${yAxisCapMinutes === cap ? ' is-active' : ''}`}
                    onClick={() => setYAxisCapMinutes(cap)}
                  >
                    {cap}m
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="chart-legend chart-legend-below" aria-label="NDL Chart Legend">
            <span className="legend-item">
              <span className="legend-swatch swatch-depth" />
              {formatMixLabel(o2Percent)} @ GF High {gfHighPercent}%
            </span>
            {gf100LinePath && (
              <span className="legend-item">
                <span className="legend-swatch swatch-gf100" />
                {formatMixLabel(o2Percent)} @ GF 100%
              </span>
            )}
            {airLinePath && (
              <span className="legend-item">
                <span className="legend-swatch swatch-air" />
                Air 21% @ GF {gfHighPercent}%
              </span>
            )}
            {mod14InRange && (
              <span className="legend-item">
                <span className="legend-swatch swatch-mod" />
                MOD 1.4 bar ({primaryCurve.mod14Meters.toFixed(1)} m)
              </span>
            )}
          </div>

          <div className="profile-svg-wrap">
            <svg
              ref={svgRef}
              id="ndl-curve-svg"
              className="profile-svg"
              viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
              role="img"
              aria-label={`NDL vs depth curve from ${minDepthMeters} to ${effectiveMaxDepth} meters at GF High ${gfHighPercent}% for ${formatMixLabel(o2Percent)}`}
              onPointerMove={handlePointerMove}
              onPointerLeave={() => setHoveredDepth(null)}
            >
              <defs>
                <linearGradient id="ndl-area-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-water-top)" />
                  <stop offset="100%" stopColor="var(--chart-water-bottom)" />
                </linearGradient>
              </defs>

              {/* Unlimited shallow NDL zone shading */}
              {unlimitedZoneEndX !== null && (
                <rect
                  x={PAD_LEFT}
                  y={PAD_TOP}
                  width={Math.max(0, unlimitedZoneEndX - PAD_LEFT)}
                  height={PLOT_H}
                  fill="var(--status-ok-bg)"
                  opacity={0.55}
                />
              )}

              {/* Beyond MOD 1.4 bar shading */}
              {mod14InRange && (
                <rect
                  x={toChartX(primaryCurve.mod14Meters, minDepthMeters, effectiveMaxDepth)}
                  y={PAD_TOP}
                  width={Math.max(
                    0,
                    PAD_LEFT +
                      PLOT_W -
                      toChartX(primaryCurve.mod14Meters, minDepthMeters, effectiveMaxDepth),
                  )}
                  height={PLOT_H}
                  fill="var(--chart-ceiling-fill)"
                  opacity={0.45}
                />
              )}

              {/* Horizontal NDL minute gridlines */}
              {yTicks.map((m) => {
                const y = toChartY(m, yAxisCapMinutes)
                return (
                  <g key={`y-${m}`}>
                    <line
                      x1={PAD_LEFT}
                      y1={y}
                      x2={PAD_LEFT + PLOT_W}
                      y2={y}
                      stroke="var(--chart-grid)"
                      strokeWidth={m === 0 ? 1.4 : 1}
                    />
                    <text x={PAD_LEFT - 8} y={y + 4} textAnchor="end" className="svg-axis-label">
                      {m}
                    </text>
                  </g>
                )
              })}

              {/* Vertical depth gridlines */}
              {depthTicks.map((d) => {
                const x = toChartX(d, minDepthMeters, effectiveMaxDepth)
                return (
                  <g key={`x-${d}`}>
                    <line
                      x1={x}
                      y1={PAD_TOP}
                      x2={x}
                      y2={PAD_TOP + PLOT_H}
                      stroke="var(--chart-grid)"
                      strokeWidth={1}
                    />
                    <text
                      x={x}
                      y={PAD_TOP + PLOT_H + 18}
                      textAnchor="middle"
                      className="svg-axis-label"
                    >
                      {d}m
                    </text>
                  </g>
                )
              })}

              <text
                x={14}
                y={PAD_TOP + PLOT_H / 2}
                textAnchor="middle"
                transform={`rotate(-90 14 ${PAD_TOP + PLOT_H / 2})`}
                className="svg-axis-title"
              >
                NDL (min)
              </text>

              <text
                x={PAD_LEFT + PLOT_W / 2}
                y={SVG_HEIGHT - 6}
                textAnchor="middle"
                className="svg-axis-title"
              >
                Depth (m)
              </text>

              {/* MOD 1.4 vertical threshold line */}
              {mod14InRange && (
                <g pointerEvents="none">
                  <line
                    x1={toChartX(primaryCurve.mod14Meters, minDepthMeters, effectiveMaxDepth)}
                    y1={PAD_TOP}
                    x2={toChartX(primaryCurve.mod14Meters, minDepthMeters, effectiveMaxDepth)}
                    y2={PAD_TOP + PLOT_H}
                    stroke="var(--chart-ceiling-stroke)"
                    strokeWidth={1.5}
                    strokeDasharray="5 3"
                  />
                  <text
                    x={toChartX(primaryCurve.mod14Meters, minDepthMeters, effectiveMaxDepth) - 4}
                    y={PAD_TOP + 13}
                    textAnchor="end"
                    className="svg-axis-label"
                  >
                    MOD 1.4
                  </text>
                </g>
              )}

              {/* Comparison Curves */}
              {gf100LinePath && (
                <path
                  d={gf100LinePath}
                  fill="none"
                  stroke="var(--chart-gflow-stroke)"
                  strokeWidth={1.8}
                  strokeDasharray="5 4"
                  strokeLinejoin="round"
                />
              )}

              {airLinePath && (
                <path
                  d={airLinePath}
                  fill="none"
                  stroke="var(--text-muted)"
                  strokeWidth={1.8}
                  strokeDasharray="2 3"
                  strokeLinejoin="round"
                />
              )}

              {/* Primary NDL Curve & Area */}
              {primaryAreaPath && <path d={primaryAreaPath} fill="url(#ndl-area-grad)" />}
              {primaryLinePath && (
                <path
                  d={primaryLinePath}
                  fill="none"
                  stroke="var(--chart-profile)"
                  strokeWidth={2.6}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}

              {/* Point markers when step >= 2 m */}
              {depthStepMeters >= 2 &&
                primaryCurve.points.map((pt) => {
                  if (pt.isUnlimited) return null
                  return (
                    <circle
                      key={`pt-${pt.depthMeters}`}
                      cx={toChartX(pt.depthMeters, minDepthMeters, effectiveMaxDepth)}
                      cy={toChartY(pt.ndlMinutes, yAxisCapMinutes)}
                      r={3.2}
                      fill="var(--chart-profile)"
                      stroke="var(--bg-surface)"
                      strokeWidth={1.2}
                    />
                  )
                })}

              {/* Hover Crosshair */}
              {activePoint && (
                <g pointerEvents="none">
                  <line
                    x1={toChartX(activePoint.depthMeters, minDepthMeters, effectiveMaxDepth)}
                    y1={PAD_TOP}
                    x2={toChartX(activePoint.depthMeters, minDepthMeters, effectiveMaxDepth)}
                    y2={PAD_TOP + PLOT_H}
                    stroke="var(--chart-crosshair)"
                    strokeWidth={1.2}
                    strokeDasharray="3 3"
                  />
                  {!activePoint.isUnlimited && (
                    <circle
                      cx={toChartX(activePoint.depthMeters, minDepthMeters, effectiveMaxDepth)}
                      cy={toChartY(activePoint.ndlMinutes, yAxisCapMinutes)}
                      r={4.8}
                      fill="var(--chart-profile)"
                      stroke="var(--bg-surface)"
                      strokeWidth={1.6}
                    />
                  )}
                  {activeGf100Point && !activeGf100Point.isUnlimited && gf100LinePath && (
                    <circle
                      cx={toChartX(
                        activeGf100Point.depthMeters,
                        minDepthMeters,
                        effectiveMaxDepth,
                      )}
                      cy={toChartY(activeGf100Point.ndlMinutes, yAxisCapMinutes)}
                      r={3.6}
                      fill="var(--chart-gflow-stroke)"
                      stroke="var(--bg-surface)"
                      strokeWidth={1.2}
                    />
                  )}
                </g>
              )}
            </svg>
          </div>

          {activePoint && (
            <div className="scrub-bar" id="ndl-telemetry-bar">
              <span>
                {hoveredDepth !== null
                  ? 'Inspecting depth'
                  : 'Reference point (hover chart to scrub)'}
              </span>
              <div className="scrub-metrics">
                <span>
                  Depth: <strong>{activePoint.depthMeters} m</strong>
                </span>
                <span>
                  NDL: <strong>{formatNdlValue(activePoint.ndlMinutes)}</strong>
                </span>
                <span>
                  Comp:{' '}
                  <strong>
                    #{activePoint.leadingCompartment} (
                    {compartments[activePoint.leadingCompartment - 1].n2HalfTime}m)
                  </strong>
                </span>
                <span>
                  ppO₂: <strong>{activePoint.bottomPpO2Bar.toFixed(2)} bar</strong>
                </span>
                {activeGf100Point && (
                  <span>
                    GF 100%: <strong>{formatNdlValue(activeGf100Point.ndlMinutes)}</strong>
                  </span>
                )}
                {activeAirPoint && (
                  <span>
                    Air 21%: <strong>{formatNdlValue(activeAirPoint.ndlMinutes)}</strong>
                  </span>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Tabular NDL Readout */}
        <section
          className="surface-panel"
          id="ndl-table-panel"
          aria-labelledby="ndl-table-heading"
        >
          <div className="panel-header">
            <h2 className="panel-title" id="ndl-table-heading">
              NDL Depth Schedule ({formatMixLabel(o2Percent)} &middot; GF High {gfHighPercent}
              %)
            </h2>
            <span className="field-meta">
              {depthStepMeters === 1 ? 'Showing 3 m intervals' : `Every ${depthStepMeters} m`}
            </span>
          </div>

          <div className="table-scroll">
            <table className="data-table" id="ndl-table">
              <thead>
                <tr>
                  <th>Depth</th>
                  <th className="num">NDL</th>
                  {gf100Curve && <th className="num">GF 100%</th>}
                  {airBaselineCurve && <th className="num">Air 21%</th>}
                  <th className="num">Lead Comp</th>
                  <th className="num">ppO₂</th>
                  <th className="num">Profile</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((pt) => {
                  const gf100Pt = gf100Curve?.points.find(
                    (p) => p.depthMeters === pt.depthMeters,
                  )
                  const airPt = airBaselineCurve?.points.find(
                    (p) => p.depthMeters === pt.depthMeters,
                  )
                  const comp = compartments[pt.leadingCompartment - 1]
                  const overMod14 = pt.bottomPpO2Bar > 1.4001
                  return (
                    <tr
                      key={pt.depthMeters}
                      className={overMod14 ? 'row-deco' : undefined}
                    >
                      <td>
                        <strong>{pt.depthMeters} m</strong>
                      </td>
                      <td className="num">
                        <strong>{formatNdlValue(pt.ndlMinutes)}</strong>
                      </td>
                      {gf100Curve && (
                        <td className="num">
                          {gf100Pt ? formatNdlValue(gf100Pt.ndlMinutes) : '—'}
                        </td>
                      )}
                      {airBaselineCurve && (
                        <td className="num">
                          {airPt ? formatNdlValue(airPt.ndlMinutes) : '—'}
                        </td>
                      )}
                      <td className="num">
                        #{comp.index} ({comp.n2HalfTime}m)
                      </td>
                      <td className="num">{pt.bottomPpO2Bar.toFixed(2)} bar</td>
                      <td className="num">
                        <button
                          type="button"
                          className="table-action-btn"
                          onClick={() =>
                            onInspectInProfilePlanner(
                              pt.depthMeters,
                              pt.ndlMinutes !== null
                                ? Math.max(5, pt.ndlMinutes)
                                : 60,
                            )
                          }
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
