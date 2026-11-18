import { useMemo, useRef, useState } from 'react'
import { WATER_DENSITY_PRESETS } from '../engine/constants'
import type { WaterDensityId, Zhl16Variant } from '../engine/constants'
import { calculateDecoVsBottomTimeCurve, depthToPressure } from '../engine/zhl16c'
import type { DecoBottomTimePoint, GfAnchorMode } from '../engine/zhl16c'
import { NumericInput } from './NumericInput'

interface DecoBottomTimeViewProps {
  readonly depthMeters: number
  readonly onChangeDepthMeters: (value: number) => void
  readonly o2Percent: number
  readonly onChangeO2Percent: (value: number) => void
  readonly gfLowPercent: number
  readonly onChangeGfLowPercent: (value: number) => void
  readonly gfHighPercent: number
  readonly onChangeGfHighPercent: (value: number) => void
  readonly ascentRateMPerMin: number
  readonly onChangeAscentRateMPerMin: (value: number) => void
  readonly descentRateMPerMin: number
  readonly onChangeDescentRateMPerMin: (value: number) => void
  readonly decoStepSizeMeters: number
  readonly onChangeDecoStepSizeMeters: (value: number) => void
  readonly lastStopDepthMeters: number
  readonly onChangeLastStopDepthMeters: (value: number) => void
  readonly variant: Zhl16Variant
  readonly onChangeVariant: (value: Zhl16Variant) => void
  readonly waterDensityId: WaterDensityId
  readonly onChangeWaterDensityId: (value: WaterDensityId) => void
  readonly gfAnchorMode: GfAnchorMode
  readonly onChangeGfAnchorMode: (value: GfAnchorMode) => void
  readonly onInspectInProfilePlanner: (depthMeters: number, bottomTimeMinutes: number) => void
}

const GAS_PRESETS = [
  { label: 'Air 21%', o2: 21 },
  { label: 'EAN32', o2: 32 },
  { label: 'EAN36', o2: 36 },
  { label: 'EAN50', o2: 50 },
] as const

const GF_PRESETS = [
  { label: '30 / 70', low: 30, high: 70 },
  { label: '30 / 85', low: 30, high: 85 },
  { label: '40 / 85', low: 40, high: 85 },
  { label: '50 / 85', low: 50, high: 85 },
  { label: '100 / 100', low: 100, high: 100 },
] as const

const STOP_PALETTE = [
  'hsl(192, 76%, 46%)',
  'hsl(206, 80%, 46%)',
  'hsl(166, 62%, 40%)',
  'hsl(42, 86%, 48%)',
  'hsl(26, 84%, 50%)',
  'hsl(12, 78%, 50%)',
  'hsl(2, 70%, 50%)',
  'hsl(218, 68%, 40%)',
] as const

const SVG_WIDTH = 800
const SVG_HEIGHT = 355
const PAD_LEFT = 54
const PAD_RIGHT = 24
const PAD_TOP = 24
const PAD_BOTTOM = 42
const PLOT_W = SVG_WIDTH - PAD_LEFT - PAD_RIGHT
const PLOT_H = SVG_HEIGHT - PAD_TOP - PAD_BOTTOM

function chooseTickStep(span: number, targetCount: number): number {
  const raw = span / Math.max(1, targetCount)
  const niceSteps = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120]
  for (const s of niceSteps) {
    if (s >= raw) return s
  }
  return Math.ceil(raw / 50) * 50
}

function formatMixLabel(o2Percent: number): string {
  if (o2Percent === 21) return 'Air (21% O₂)'
  if (o2Percent === 100) return 'Pure O₂ (100%)'
  return `EAN${o2Percent} (${o2Percent}% O₂)`
}

function getStopColor(index: number, totalStops: number): string {
  if (totalStops <= STOP_PALETTE.length) {
    return STOP_PALETTE[index % STOP_PALETTE.length]
  }
  const t = totalStops <= 1 ? 0 : index / (totalStops - 1)
  const hue = Math.round(196 - t * 184) // 196 (cyan-blue) down to 12 (terracotta)
  const sat = Math.round(74 + Math.sin(t * Math.PI) * 10)
  const light = index % 2 === 0 ? 48 : 41
  return `hsl(${hue}, ${sat}%, ${light}%)`
}

function toChartX(bottomTime: number, minBt: number, maxBt: number): number {
  const span = Math.max(1, maxBt - minBt)
  return PAD_LEFT + ((bottomTime - minBt) / span) * PLOT_W
}

function toChartY(minutes: number, maxYAxis: number): number {
  const clamped = Math.min(maxYAxis, Math.max(0, minutes))
  return PAD_TOP + (1 - clamped / maxYAxis) * PLOT_H
}

interface StopBandGeometry {
  readonly stopDepthMeters: number
  readonly color: string
  readonly areaPath: string
  readonly topLinePath: string
}

function buildBandGeometries(
  points: readonly DecoBottomTimePoint[],
  stopDepthsMeters: readonly number[],
  minBt: number,
  maxBt: number,
  maxYAxis: number,
): StopBandGeometry[] {
  if (points.length === 0 || stopDepthsMeters.length === 0) return []

  const cumulativeBase = new Array<number>(points.length).fill(0)
  const bands: StopBandGeometry[] = []

  for (let sIdx = 0; sIdx < stopDepthsMeters.length; sIdx++) {
    const stopDepth = stopDepthsMeters[sIdx]
    const topValues = new Array<number>(points.length)
    const baseCoords: string[] = []
    const topCoords: string[] = []

    for (let i = 0; i < points.length; i++) {
      const dur = points[i].stopDurationsByDepth[stopDepth] ?? 0
      const baseVal = cumulativeBase[i]
      const topVal = baseVal + dur
      topValues[i] = topVal

      const xStr = toChartX(points[i].bottomTimeMinutes, minBt, maxBt).toFixed(2)
      topCoords.push(`${xStr},${toChartY(topVal, maxYAxis).toFixed(2)}`)
      baseCoords.push(`${xStr},${toChartY(baseVal, maxYAxis).toFixed(2)}`)
      cumulativeBase[i] = topVal
    }

    const areaPath = `M ${topCoords.join(' L ')} L ${baseCoords.reverse().join(' L ')} Z`
    const topLinePath = `M ${topCoords.join(' L ')}`

    bands.push({
      stopDepthMeters: stopDepth,
      color: getStopColor(sIdx, stopDepthsMeters.length),
      areaPath,
      topLinePath,
    })
  }

  return bands
}

export function DecoBottomTimeView({
  depthMeters,
  onChangeDepthMeters,
  o2Percent,
  onChangeO2Percent,
  gfLowPercent,
  onChangeGfLowPercent,
  gfHighPercent,
  onChangeGfHighPercent,
  ascentRateMPerMin,
  onChangeAscentRateMPerMin,
  descentRateMPerMin,
  onChangeDescentRateMPerMin,
  decoStepSizeMeters,
  onChangeDecoStepSizeMeters,
  lastStopDepthMeters,
  onChangeLastStopDepthMeters,
  variant,
  onChangeVariant,
  waterDensityId,
  onChangeWaterDensityId,
  gfAnchorMode,
  onChangeGfAnchorMode,
  onInspectInProfilePlanner,
}: DecoBottomTimeViewProps) {
  const [minBottomTimeMinutes, setMinBottomTimeMinutes] = useState<number>(10)
  const [maxBottomTimeMinutes, setMaxBottomTimeMinutes] = useState<number>(60)
  const [showTtsOverlay, setShowTtsOverlay] = useState<boolean>(true)
  const [hoveredBottomTime, setHoveredBottomTime] = useState<number | null>(null)

  const svgRef = useRef<SVGSVGElement | null>(null)
  const barPerMeter = WATER_DENSITY_PRESETS[waterDensityId].barPerMeter
  const effectiveMaxBt = Math.max(minBottomTimeMinutes + 1, maxBottomTimeMinutes)
  const bottomTimeStepMinutes = effectiveMaxBt - minBottomTimeMinutes > 120 ? 2 : 1

  const sweep = useMemo(
    () =>
      calculateDecoVsBottomTimeCurve({
        depthMeters,
        minBottomTimeMinutes,
        maxBottomTimeMinutes: effectiveMaxBt,
        bottomTimeStepMinutes,
        o2Percent,
        gfLowPercent,
        gfHighPercent,
        ascentRateMPerMin,
        descentRateMPerMin,
        decoStepSizeMeters,
        lastStopDepthMeters,
        variant,
        barPerMeter,
        gfAnchorMode,
      }),
    [
      depthMeters,
      minBottomTimeMinutes,
      effectiveMaxBt,
      bottomTimeStepMinutes,
      o2Percent,
      gfLowPercent,
      gfHighPercent,
      ascentRateMPerMin,
      descentRateMPerMin,
      decoStepSizeMeters,
      lastStopDepthMeters,
      variant,
      barPerMeter,
      gfAnchorMode,
    ],
  )

  const maxYAxis = useMemo(() => {
    const rawMax = Math.max(
      10,
      ...sweep.points.map((p) =>
        showTtsOverlay ? p.ttsMinutes : p.totalDecoStopMinutes,
      ),
    )
    const step = chooseTickStep(rawMax * 1.08, 6)
    return Math.max(step, Math.ceil((rawMax * 1.08) / step) * step)
  }, [sweep.points, showTtsOverlay])

  const bands = useMemo(
    () =>
      buildBandGeometries(
        sweep.points,
        sweep.stopDepthsMeters,
        minBottomTimeMinutes,
        effectiveMaxBt,
        maxYAxis,
      ),
    [
      sweep.points,
      sweep.stopDepthsMeters,
      minBottomTimeMinutes,
      effectiveMaxBt,
      maxYAxis,
    ],
  )

  const ttsLinePath = useMemo(() => {
    if (!showTtsOverlay || sweep.points.length === 0) return ''
    const coords = sweep.points.map(
      (p) =>
        `${toChartX(p.bottomTimeMinutes, minBottomTimeMinutes, effectiveMaxBt).toFixed(2)},${toChartY(p.ttsMinutes, maxYAxis).toFixed(2)}`,
    )
    return `M ${coords.join(' L ')}`
  }, [showTtsOverlay, sweep.points, minBottomTimeMinutes, effectiveMaxBt, maxYAxis])

  const xTicks = useMemo(() => {
    const step = chooseTickStep(effectiveMaxBt - minBottomTimeMinutes, 8)
    const first = Math.ceil(minBottomTimeMinutes / step) * step
    const ticks: number[] = []
    for (let t = first; t <= effectiveMaxBt + 1e-6; t += step) {
      ticks.push(t)
    }
    return ticks
  }, [minBottomTimeMinutes, effectiveMaxBt])

  const yTicks = useMemo(() => {
    const step = chooseTickStep(maxYAxis, 6)
    const ticks: number[] = []
    for (let m = 0; m <= maxYAxis + 1e-6; m += step) {
      ticks.push(m)
    }
    return ticks
  }, [maxYAxis])

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const el = svgRef.current
    if (!el || sweep.points.length === 0) return
    const rect = el.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * SVG_WIDTH
    const clampedX = Math.max(PAD_LEFT, Math.min(PAD_LEFT + PLOT_W, svgX))
    const targetBt =
      minBottomTimeMinutes +
      ((clampedX - PAD_LEFT) / PLOT_W) * Math.max(1, effectiveMaxBt - minBottomTimeMinutes)

    let nearest = sweep.points[0]
    let minDiff = Math.abs(nearest.bottomTimeMinutes - targetBt)
    for (const pt of sweep.points) {
      const diff = Math.abs(pt.bottomTimeMinutes - targetBt)
      if (diff < minDiff) {
        minDiff = diff
        nearest = pt
      }
    }
    setHoveredBottomTime(nearest.bottomTimeMinutes)
  }

  const lastPoint = sweep.points[sweep.points.length - 1]
  const activePoint =
    (hoveredBottomTime !== null
      ? sweep.points.find((p) => p.bottomTimeMinutes === hoveredBottomTime)
      : undefined) ?? lastPoint

  const ndlInRange =
    sweep.ndlMinutes !== null &&
    sweep.ndlMinutes >= minBottomTimeMinutes &&
    sweep.ndlMinutes <= effectiveMaxBt

  const bottomPressureBar = depthToPressure(
    depthMeters,
    sweep.input.surfacePressureBar,
    barPerMeter,
  )
  const ppO2StatusClass =
    sweep.bottomPpO2Bar > 1.6001
      ? ' is-high'
      : sweep.bottomPpO2Bar > 1.4001
        ? ' is-elevated'
        : ''

  const tableRows = useMemo(() => {
    if (sweep.points.length <= 16) return sweep.points
    const step = chooseTickStep(effectiveMaxBt - minBottomTimeMinutes, 10)
    return sweep.points.filter(
      (p) =>
        p.bottomTimeMinutes === minBottomTimeMinutes ||
        p.bottomTimeMinutes === effectiveMaxBt ||
        Math.round(p.bottomTimeMinutes) % step === 0,
    )
  }, [sweep.points, minBottomTimeMinutes, effectiveMaxBt])

  const deepestStopOverall =
    sweep.stopDepthsMeters.length > 0
      ? sweep.stopDepthsMeters[sweep.stopDepthsMeters.length - 1]
      : null

  return (
    <div className="planner-workspace" id="deco-bt-workspace">
      {/* Sidebar Controls */}
      <aside
        className="controls-panel"
        id="deco-bt-controls"
        aria-label="Deco vs Bottom Time Parameters"
      >
        <div className="control-group">
          <div className="group-heading-row">
            <h2 className="group-heading">Depth &amp; Breathing Mix</h2>
            <span className="field-meta">{formatMixLabel(o2Percent)}</span>
          </div>

          <div className="field-block">
            <div className="field-header">
              <label className="field-label" htmlFor="decobt-input-depth">
                Target Depth
              </label>
              <span className="field-meta">{bottomPressureBar.toFixed(2)} bar abs</span>
            </div>
            <div className="slider-number-row">
              <input
                id="decobt-slider-depth"
                className="range-input"
                type="range"
                min={6}
                max={70}
                step={1}
                value={Math.min(70, depthMeters)}
                onChange={(e) => onChangeDepthMeters(Number(e.target.value))}
              />
              <div className="number-unit-wrap">
                <NumericInput
                  id="decobt-input-depth"
                  min={1}
                  max={150}
                  step={1}
                  value={depthMeters}
                  onChange={onChangeDepthMeters}
                />
                <span className="unit-suffix">m</span>
              </div>
            </div>
          </div>

          <div className="field-block">
            <div className="field-header">
              <label className="field-label" htmlFor="decobt-input-o2">
                Nitrox O₂
              </label>
              <span className="field-meta">{100 - o2Percent}% N₂</span>
            </div>
            <div className="slider-number-row">
              <input
                id="decobt-slider-o2"
                className="range-input"
                type="range"
                min={21}
                max={100}
                step={1}
                value={o2Percent}
                onChange={(e) => onChangeO2Percent(Number(e.target.value))}
              />
              <div className="number-unit-wrap">
                <NumericInput
                  id="decobt-input-o2"
                  min={21}
                  max={100}
                  step={1}
                  value={o2Percent}
                  onChange={onChangeO2Percent}
                />
                <span className="unit-suffix">%</span>
              </div>
            </div>
            <div className="preset-row" role="group" aria-label="Gas Mix Presets">
              {GAS_PRESETS.map((preset) => (
                <button
                  key={preset.o2}
                  id={`decobt-preset-gas-${preset.o2}`}
                  type="button"
                  className={`preset-btn${o2Percent === preset.o2 ? ' is-active' : ''}`}
                  onClick={() => onChangeO2Percent(preset.o2)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className={`ppo2-readout${ppO2StatusClass}`} id="decobt-ppo2-readout">
              <span>Bottom ppO₂: {sweep.bottomPpO2Bar.toFixed(2)} bar</span>
              <span>MOD 1.4: {sweep.mod14Meters.toFixed(1)} m</span>
            </div>
          </div>
        </div>

        <div className="control-group">
          <div className="group-heading-row">
            <h2 className="group-heading">Gradient Factors</h2>
            <span className="field-meta">
              GF {gfLowPercent}/{gfHighPercent}
            </span>
          </div>

          <div className="field-block">
            <div className="field-header">
              <label className="field-label" htmlFor="decobt-input-gf-low">
                GF Low
              </label>
              <span className="field-meta">Shifts deeper stop bands</span>
            </div>
            <div className="slider-number-row">
              <input
                id="decobt-slider-gf-low"
                className="range-input"
                type="range"
                min={10}
                max={100}
                step={5}
                value={gfLowPercent}
                onChange={(e) => onChangeGfLowPercent(Number(e.target.value))}
              />
              <div className="number-unit-wrap">
                <NumericInput
                  id="decobt-input-gf-low"
                  min={1}
                  max={100}
                  step={1}
                  value={gfLowPercent}
                  onChange={onChangeGfLowPercent}
                />
                <span className="unit-suffix">%</span>
              </div>
            </div>
          </div>

          <div className="field-block">
            <div className="field-header">
              <label className="field-label" htmlFor="decobt-input-gf-high">
                GF High
              </label>
              <span className="field-meta">Shifts shallow stops &amp; NDL</span>
            </div>
            <div className="slider-number-row">
              <input
                id="decobt-slider-gf-high"
                className="range-input"
                type="range"
                min={30}
                max={100}
                step={5}
                value={gfHighPercent}
                onChange={(e) => onChangeGfHighPercent(Number(e.target.value))}
              />
              <div className="number-unit-wrap">
                <NumericInput
                  id="decobt-input-gf-high"
                  min={1}
                  max={100}
                  step={1}
                  value={gfHighPercent}
                  onChange={onChangeGfHighPercent}
                />
                <span className="unit-suffix">%</span>
              </div>
            </div>
          </div>

          <div className="preset-row" role="group" aria-label="Gradient Factor Presets">
            {GF_PRESETS.map((preset) => {
              const active = gfLowPercent === preset.low && gfHighPercent === preset.high
              return (
                <button
                  key={preset.label}
                  id={`decobt-preset-gf-${preset.low}-${preset.high}`}
                  type="button"
                  className={`preset-btn${active ? ' is-active' : ''}`}
                  onClick={() => {
                    onChangeGfLowPercent(preset.low)
                    onChangeGfHighPercent(preset.high)
                  }}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="control-group">
          <div className="group-heading-row">
            <h2 className="group-heading">Sweep Range &amp; Geometry</h2>
            <span className="field-meta">Metric</span>
          </div>

          <div className="compact-grid-2">
            <div className="field-block">
              <label className="field-label" htmlFor="decobt-input-min-bt">
                Min Bottom Time
              </label>
              <div className="number-unit-wrap">
                <NumericInput
                  id="decobt-input-min-bt"
                  min={1}
                  max={120}
                  step={1}
                  value={minBottomTimeMinutes}
                  onChange={(next) => {
                    setMinBottomTimeMinutes(next)
                    if (next >= maxBottomTimeMinutes) setMaxBottomTimeMinutes(next + 15)
                  }}
                />
                <span className="unit-suffix">min</span>
              </div>
            </div>

            <div className="field-block">
              <label className="field-label" htmlFor="decobt-input-max-bt">
                Max Bottom Time
              </label>
              <div className="number-unit-wrap">
                <NumericInput
                  id="decobt-input-max-bt"
                  min={minBottomTimeMinutes + 1}
                  max={240}
                  step={5}
                  value={maxBottomTimeMinutes}
                  onChange={setMaxBottomTimeMinutes}
                />
                <span className="unit-suffix">min</span>
              </div>
            </div>

            <div className="field-block">
              <label className="field-label" htmlFor="decobt-input-step-size">
                Deco Step Size
              </label>
              <div className="number-unit-wrap">
                <NumericInput
                  id="decobt-input-step-size"
                  min={0.5}
                  max={30}
                  step={0.5}
                  value={decoStepSizeMeters}
                  onChange={onChangeDecoStepSizeMeters}
                />
                <span className="unit-suffix">m</span>
              </div>
            </div>

            <div className="field-block">
              <label className="field-label" htmlFor="decobt-input-last-stop">
                Last Stop Depth
              </label>
              <div className="number-unit-wrap">
                <NumericInput
                  id="decobt-input-last-stop"
                  min={1}
                  max={30}
                  step={0.5}
                  value={lastStopDepthMeters}
                  onChange={onChangeLastStopDepthMeters}
                />
                <span className="unit-suffix">m</span>
              </div>
            </div>

            <div className="field-block">
              <label className="field-label" htmlFor="decobt-input-ascent-rate">
                Ascent Rate
              </label>
              <div className="number-unit-wrap">
                <NumericInput
                  id="decobt-input-ascent-rate"
                  min={1}
                  max={60}
                  step={1}
                  value={ascentRateMPerMin}
                  onChange={onChangeAscentRateMPerMin}
                />
                <span className="unit-suffix">m/min</span>
              </div>
            </div>

            <div className="field-block">
              <label className="field-label" htmlFor="decobt-input-descent-rate">
                Descent Rate
              </label>
              <div className="number-unit-wrap">
                <NumericInput
                  id="decobt-input-descent-rate"
                  min={1}
                  max={60}
                  step={1}
                  value={descentRateMPerMin}
                  onChange={onChangeDescentRateMPerMin}
                />
                <span className="unit-suffix">m/min</span>
              </div>
            </div>
          </div>

          <div className="checkbox-stack">
            <label className="checkbox-row" htmlFor="decobt-checkbox-tts">
              <input
                id="decobt-checkbox-tts"
                type="checkbox"
                checked={showTtsOverlay}
                onChange={(e) => setShowTtsOverlay(e.target.checked)}
              />
              <span>Overlay total TTS curve (ascent transit + stops)</span>
            </label>
          </div>
        </div>

        <details className="advanced-details" id="decobt-advanced-settings">
          <summary className="advanced-summary">Model Variants &amp; Physical Constants</summary>
          <div className="advanced-body">
            <div className="field-block">
              <label className="field-label" htmlFor="decobt-select-variant">
                Compartment 1 Half-Time Set
              </label>
              <select
                id="decobt-select-variant"
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
              <label className="field-label" htmlFor="decobt-select-water-density">
                Hydrostatic Water Conversion
              </label>
              <select
                id="decobt-select-water-density"
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

            <div className="field-block">
              <label className="field-label" htmlFor="decobt-select-gf-anchor">
                GF Low Ramp Anchor
              </label>
              <select
                id="decobt-select-gf-anchor"
                className="select-input"
                value={gfAnchorMode}
                onChange={(e) => onChangeGfAnchorMode(e.target.value as GfAnchorMode)}
              >
                <option value="continuous_ceiling">
                  Continuous Ceiling (Subsurface / Shearwater)
                </option>
                <option value="first_stop">First Grid Stop (Erik Baker / MultiDeco)</option>
              </select>
            </div>
          </div>
        </details>
      </aside>

      {/* Main Chart & Schedule Table */}
      <div className="results-column">
        <section
          className="metrics-strip"
          id="decobt-summary-metrics"
          aria-label="Deco Sweep Summary"
        >
          <div className="metric-cell">
            <span className="metric-label">NDL at {depthMeters} m</span>
            <span className="metric-value" id="decobt-metric-ndl">
              {sweep.ndlMinutes === null ? 'Unlimited' : `${sweep.ndlMinutes} min`}
            </span>
            <span className="metric-sub">GF High {gfHighPercent}%</span>
          </div>

          <div className="metric-cell">
            <span className="metric-label">Deco @ {effectiveMaxBt} min</span>
            <span className="metric-value" id="decobt-metric-max-deco">
              {lastPoint ? `${lastPoint.totalDecoStopMinutes} min` : '0 min'}
            </span>
            <span className="metric-sub">
              {lastPoint ? `TTS ${lastPoint.ttsMinutes.toFixed(1)} min` : '—'}
            </span>
          </div>

          <div className="metric-cell">
            <span className="metric-label">Deepest Stop</span>
            <span className="metric-value" id="decobt-metric-deepest-stop">
              {deepestStopOverall !== null ? `${deepestStopOverall} m` : 'None'}
            </span>
            <span className="metric-sub">
              {sweep.stopDepthsMeters.length} active stop{' '}
              {sweep.stopDepthsMeters.length === 1 ? 'level' : 'levels'}
            </span>
          </div>

          <div className="metric-cell">
            <span className="metric-label">Gradient Factors</span>
            <span className="metric-value" id="decobt-metric-gf">
              {gfLowPercent} / {gfHighPercent}
            </span>
            <span className="metric-sub">{formatMixLabel(o2Percent)}</span>
          </div>

          <div className="metric-cell">
            <span className="metric-label">Stop Grid</span>
            <span className="metric-value" id="decobt-metric-grid">
              {decoStepSizeMeters} m step
            </span>
            <span className="metric-sub">Last stop {lastStopDepthMeters} m</span>
          </div>
        </section>

        <section
          className="surface-panel"
          id="decobt-chart-panel"
          aria-labelledby="decobt-chart-heading"
        >
          <div className="panel-header">
            <h2 className="panel-title" id="decobt-chart-heading">
              Mandatory Deco Time vs. Bottom Time at {depthMeters} m ({formatMixLabel(o2Percent)})
            </h2>
            <span className="field-meta">
              Shaded by stop depth (shallowest at base)
            </span>
          </div>

          <div className="chart-legend chart-legend-below" aria-label="Stop Depth Color Legend">
            {bands.length === 0 ? (
              <span className="field-meta">
                Entire bottom time range stays within NDL (0 mandatory stops).
              </span>
            ) : (
              bands.map((band) => (
                <span key={`legend-${band.stopDepthMeters}`} className="legend-item">
                  <span
                    className="legend-color-box"
                    style={{ backgroundColor: band.color }}
                  />
                  {band.stopDepthMeters} m stop
                </span>
              ))
            )}
            {showTtsOverlay && (
              <span className="legend-item">
                <span className="legend-swatch swatch-tts" />
                Total TTS (incl. {depthMeters} m ascent)
              </span>
            )}
          </div>

          <div className="profile-svg-wrap">
            <svg
              ref={svgRef}
              id="decobt-svg"
              className="profile-svg"
              viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
              role="img"
              aria-label={`Stacked decompression stop time vs bottom time at ${depthMeters} meters from ${minBottomTimeMinutes} to ${effectiveMaxBt} minutes`}
              onPointerMove={handlePointerMove}
              onPointerLeave={() => setHoveredBottomTime(null)}
            >
              {/* Horizontal Y gridlines */}
              {yTicks.map((m) => {
                const y = toChartY(m, maxYAxis)
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

              {/* Vertical X gridlines */}
              {xTicks.map((t) => {
                const x = toChartX(t, minBottomTimeMinutes, effectiveMaxBt)
                return (
                  <g key={`x-${t}`}>
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
                      {t}
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
                Deco / TTS (min)
              </text>

              <text
                x={PAD_LEFT + PLOT_W / 2}
                y={SVG_HEIGHT - 6}
                textAnchor="middle"
                className="svg-axis-title"
              >
                Bottom Time (min)
              </text>

              {/* Stacked Shaded Stop Depth Bands */}
              {bands.map((band) => (
                <g key={`band-${band.stopDepthMeters}`}>
                  <path d={band.areaPath} fill={band.color} fillOpacity={0.82} />
                  <path
                    d={band.topLinePath}
                    fill="none"
                    stroke={band.color}
                    strokeWidth={1.35}
                    strokeLinejoin="round"
                  />
                </g>
              ))}

              {/* Optional Total TTS dashed line */}
              {ttsLinePath && (
                <path
                  d={ttsLinePath}
                  fill="none"
                  stroke="var(--text-primary)"
                  strokeWidth={1.6}
                  strokeDasharray="4 3"
                  strokeLinejoin="round"
                  opacity={0.78}
                />
              )}

              {/* NDL Boundary Marker */}
              {ndlInRange && sweep.ndlMinutes !== null && (
                <g pointerEvents="none">
                  <line
                    x1={toChartX(sweep.ndlMinutes, minBottomTimeMinutes, effectiveMaxBt)}
                    y1={PAD_TOP}
                    x2={toChartX(sweep.ndlMinutes, minBottomTimeMinutes, effectiveMaxBt)}
                    y2={PAD_TOP + PLOT_H}
                    stroke="var(--status-ok-text)"
                    strokeWidth={1.4}
                    strokeDasharray="4 3"
                  />
                  <text
                    x={
                      toChartX(sweep.ndlMinutes, minBottomTimeMinutes, effectiveMaxBt) + 5
                    }
                    y={PAD_TOP + 13}
                    textAnchor="start"
                    className="svg-axis-label"
                  >
                    NDL {sweep.ndlMinutes}m
                  </text>
                </g>
              )}

              {/* Hover Crosshair */}
              {activePoint && (
                <g pointerEvents="none">
                  <line
                    x1={toChartX(
                      activePoint.bottomTimeMinutes,
                      minBottomTimeMinutes,
                      effectiveMaxBt,
                    )}
                    y1={PAD_TOP}
                    x2={toChartX(
                      activePoint.bottomTimeMinutes,
                      minBottomTimeMinutes,
                      effectiveMaxBt,
                    )}
                    y2={PAD_TOP + PLOT_H}
                    stroke="var(--chart-crosshair)"
                    strokeWidth={1.2}
                    strokeDasharray="3 3"
                  />
                  <circle
                    cx={toChartX(
                      activePoint.bottomTimeMinutes,
                      minBottomTimeMinutes,
                      effectiveMaxBt,
                    )}
                    cy={toChartY(activePoint.totalDecoStopMinutes, maxYAxis)}
                    r={4.5}
                    fill="var(--text-primary)"
                    stroke="var(--bg-surface)"
                    strokeWidth={1.5}
                  />
                </g>
              )}
            </svg>
          </div>

          {activePoint && (
            <div className="scrub-bar" id="decobt-telemetry-bar">
              <span>
                {hoveredBottomTime !== null
                  ? 'Inspecting bottom time'
                  : 'End of sweep (hover chart to scrub)'}
              </span>
              <div className="scrub-metrics">
                <span>
                  Bottom: <strong>{activePoint.bottomTimeMinutes} min</strong>
                </span>
                <span>
                  Total Deco: <strong>{activePoint.totalDecoStopMinutes} min</strong>
                </span>
                <span>
                  TTS: <strong>{activePoint.ttsMinutes.toFixed(1)} min</strong>
                </span>
                <span>
                  First Stop:{' '}
                  <strong>
                    {activePoint.firstStopDepthMeters !== null
                      ? `${activePoint.firstStopDepthMeters} m`
                      : 'NDL'}
                  </strong>
                </span>
                {activePoint.decoStops.length > 0 && (
                  <span>
                    Stops:{' '}
                    <strong>
                      {activePoint.decoStops
                        .map((s) => `${s.depthMeters}m:${s.durationMinutes}'`)
                        .join(' · ')}
                    </strong>
                  </span>
                )}
              </div>
            </div>
          )}
        </section>

        <section
          className="surface-panel"
          id="decobt-table-panel"
          aria-labelledby="decobt-table-heading"
        >
          <div className="panel-header">
            <h2 className="panel-title" id="decobt-table-heading">
              Decompression Breakdown vs. Bottom Time
            </h2>
            <span className="field-meta">
              {depthMeters} m &middot; {formatMixLabel(o2Percent)} &middot; GF {gfLowPercent}/
              {gfHighPercent}
            </span>
          </div>

          <div className="table-scroll">
            <table className="data-table" id="decobt-table">
              <thead>
                <tr>
                  <th>Bottom Time</th>
                  <th className="num">Total Deco</th>
                  <th className="num">TTS</th>
                  <th className="num">First Stop</th>
                  <th>Mandatory Stop Schedule</th>
                  <th className="num">Profile</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((pt) => (
                  <tr
                    key={pt.bottomTimeMinutes}
                    className={pt.totalDecoStopMinutes > 0 ? 'row-deco' : undefined}
                  >
                    <td>
                      <strong>{pt.bottomTimeMinutes} min</strong>
                    </td>
                    <td className="num">
                      <strong>{pt.totalDecoStopMinutes} min</strong>
                    </td>
                    <td className="num">{pt.ttsMinutes.toFixed(1)} min</td>
                    <td className="num">
                      {pt.firstStopDepthMeters !== null ? `${pt.firstStopDepthMeters} m` : 'NDL'}
                    </td>
                    <td>
                      {pt.decoStops.length === 0 ? (
                        <span className="field-meta">No mandatory stops</span>
                      ) : (
                        <span className="seg-tag">
                          {pt.decoStops
                            .map((s) => `${s.depthMeters}m (${s.durationMinutes}m)`)
                            .join(' → ')}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      <button
                        type="button"
                        className="table-action-btn"
                        onClick={() =>
                          onInspectInProfilePlanner(depthMeters, pt.bottomTimeMinutes)
                        }
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
