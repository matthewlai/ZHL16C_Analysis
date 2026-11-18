import { useMemo, useRef, useState } from 'react'
import { getCompartments } from '../engine/constants'
import type { DivePlanResult, ProfileSample } from '../engine/zhl16c'

interface DiveProfileChartProps {
  readonly plan: DivePlanResult
}

const SVG_WIDTH = 800
const SVG_HEIGHT = 330
const PAD_LEFT = 50
const PAD_RIGHT = 20
const PAD_TOP = 18
const PAD_BOTTOM = 38
const PLOT_W = SVG_WIDTH - PAD_LEFT - PAD_RIGHT
const PLOT_H = SVG_HEIGHT - PAD_TOP - PAD_BOTTOM

function chooseTickStep(span: number, targetCount: number): number {
  const raw = span / Math.max(1, targetCount)
  const niceSteps = [1, 2, 3, 5, 6, 10, 15, 20, 30, 50, 60]
  for (const s of niceSteps) {
    if (s >= raw) return s
  }
  return Math.ceil(raw / 50) * 50
}

function toSvgX(t: number, maxTimeAxis: number): number {
  return PAD_LEFT + (t / maxTimeAxis) * PLOT_W
}

function toSvgY(d: number, maxDepthAxis: number): number {
  return PAD_TOP + (d / maxDepthAxis) * PLOT_H
}

export function DiveProfileChart({ plan }: DiveProfileChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [hoveredSample, setHoveredSample] = useState<ProfileSample | null>(null)

  const maxDepthAxis = useMemo(() => {
    const rawMax = Math.max(
      plan.input.depthMeters,
      ...plan.samples.map((s) => Math.max(s.depthMeters, s.ceilingDepthMeters)),
    )
    const step = rawMax <= 18 ? 3 : rawMax <= 40 ? 5 : 10
    return Math.max(6, Math.ceil((rawMax * 1.06) / step) * step)
  }, [plan])

  const maxTimeAxis = Math.max(1, plan.totalRuntimeMinutes)

  const xOf = (t: number) => toSvgX(t, maxTimeAxis)
  const yOf = (d: number) => toSvgY(d, maxDepthAxis)

  const depthTicks = useMemo(() => {
    const step = chooseTickStep(maxDepthAxis, 6)
    const ticks: number[] = []
    for (let d = 0; d <= maxDepthAxis + 1e-6; d += step) {
      ticks.push(d)
    }
    return ticks
  }, [maxDepthAxis])

  const timeTicks = useMemo(() => {
    const step = chooseTickStep(maxTimeAxis, 8)
    const ticks: number[] = []
    for (let t = 0; t <= maxTimeAxis + 1e-6; t += step) {
      ticks.push(t)
    }
    return ticks
  }, [maxTimeAxis])

  const {
    depthLinePath,
    depthAreaPath,
    ceilingLinePath,
    ceilingAreaPath,
    gfLowLinePath,
  } = useMemo(() => {
    const pts = plan.samples
    if (pts.length === 0) {
      return {
        depthLinePath: '',
        depthAreaPath: '',
        ceilingLinePath: '',
        ceilingAreaPath: '',
        gfLowLinePath: '',
      }
    }

    const sx = (t: number) => toSvgX(t, maxTimeAxis).toFixed(2)
    const sy = (d: number) => toSvgY(d, maxDepthAxis).toFixed(2)
    const endX = sx(pts[pts.length - 1].timeMinutes)
    const startX = sx(0)
    const topY = sy(0)

    const dCoords = pts.map((s) => `${sx(s.timeMinutes)},${sy(s.depthMeters)}`)
    const dLine = `M ${dCoords.join(' L ')}`
    const dArea = `${dLine} L ${endX},${topY} L ${startX},${topY} Z`

    const cCoords = pts.map((s) => `${sx(s.timeMinutes)},${sy(s.ceilingDepthMeters)}`)
    const cLine = `M ${cCoords.join(' L ')}`
    const cArea = `${cLine} L ${endX},${topY} L ${startX},${topY} Z`

    const gfLowCoords = pts.map((s) => `${sx(s.timeMinutes)},${sy(s.gfLowCeilingMeters)}`)
    const gfLowLine = `M ${gfLowCoords.join(' L ')}`

    return {
      depthLinePath: dLine,
      depthAreaPath: dArea,
      ceilingLinePath: cLine,
      ceilingAreaPath: cArea,
      gfLowLinePath: gfLowLine,
    }
  }, [plan.samples, maxDepthAxis, maxTimeAxis])

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const el = svgRef.current
    if (!el || plan.samples.length === 0) return
    const rect = el.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * SVG_WIDTH
    const clampedX = Math.max(PAD_LEFT, Math.min(PAD_LEFT + PLOT_W, svgX))
    const targetTime = ((clampedX - PAD_LEFT) / PLOT_W) * maxTimeAxis

    // Binary search closest sample
    let lo = 0
    let hi = plan.samples.length - 1
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1
      if (plan.samples[mid].timeMinutes <= targetTime) {
        lo = mid
      } else {
        hi = mid
      }
    }
    const closer =
      Math.abs(plan.samples[lo].timeMinutes - targetTime) <=
      Math.abs(plan.samples[hi].timeMinutes - targetTime)
        ? plan.samples[lo]
        : plan.samples[hi]
    setHoveredSample(closer)
  }

  const activeSample = hoveredSample ?? plan.samples[plan.samples.length - 1]
  const compartments = getCompartments(plan.input.variant)

  return (
    <section className="surface-panel" id="dive-profile-panel" aria-labelledby="profile-chart-heading">
      <div className="panel-header">
        <h2 className="panel-title" id="profile-chart-heading">
          Dive Profile &amp; Mandatory Decompression Ceiling
        </h2>
        <div className="chart-legend" aria-label="Chart Legend">
          <span className="legend-item">
            <span className="legend-swatch swatch-depth" />
            Depth (m)
          </span>
          <span className="legend-item">
            <span className="legend-swatch swatch-ceiling" />
            Active GF Ceiling
          </span>
          <span className="legend-item">
            <span className="legend-swatch swatch-gflow" />
            GF Low Ceiling ({plan.input.gfLowPercent}%)
          </span>
        </div>
      </div>

      <div className="profile-svg-wrap">
        <svg
          ref={svgRef}
          id="dive-profile-svg"
          className="profile-svg"
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          role="img"
          aria-label={`Dive profile to ${plan.input.depthMeters} meters for ${plan.effectiveBottomTimeMinutes.toFixed(1)} minutes, total runtime ${plan.totalRuntimeMinutes.toFixed(1)} minutes`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoveredSample(null)}
        >
          <defs>
            <linearGradient id="water-depth-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-water-top)" />
              <stop offset="100%" stopColor="var(--chart-water-bottom)" />
            </linearGradient>
          </defs>

          {/* Horizontal depth gridlines */}
          {depthTicks.map((d) => {
            const y = yOf(d)
            return (
              <g key={`d-${d}`}>
                <line
                  x1={PAD_LEFT}
                  y1={y}
                  x2={PAD_LEFT + PLOT_W}
                  y2={y}
                  stroke="var(--chart-grid)"
                  strokeWidth={d === 0 ? 1.4 : 1}
                />
                <text
                  x={PAD_LEFT - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="svg-axis-label"
                >
                  {d}m
                </text>
              </g>
            )
          })}

          {/* Vertical time gridlines */}
          {timeTicks.map((t) => {
            const x = xOf(t)
            return (
              <g key={`t-${t}`}>
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
            x={PAD_LEFT + PLOT_W / 2}
            y={SVG_HEIGHT - 4}
            textAnchor="middle"
            className="svg-axis-title"
          >
            Runtime (min)
          </text>

          {/* Water depth area */}
          <path d={depthAreaPath} fill="url(#water-depth-grad)" />

          {/* Active GF ceiling zone */}
          <path d={ceilingAreaPath} fill="var(--chart-ceiling-fill)" />
          <path
            d={gfLowLinePath}
            fill="none"
            stroke="var(--chart-gflow-stroke)"
            strokeWidth={1.3}
            strokeDasharray="4 3"
          />
          <path
            d={ceilingLinePath}
            fill="none"
            stroke="var(--chart-ceiling-stroke)"
            strokeWidth={1.8}
            strokeLinejoin="round"
          />

          {/* Main dive profile line */}
          <path
            d={depthLinePath}
            fill="none"
            stroke="var(--chart-profile)"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Emphasized mandatory deco stop bars */}
          {plan.decoStops.map((stop) => {
            const x1 = xOf(stop.arrivalRuntimeMinutes)
            const x2 = xOf(stop.departureRuntimeMinutes)
            const y = yOf(stop.depthMeters)
            return (
              <line
                key={`stop-${stop.depthMeters}-${stop.arrivalRuntimeMinutes}`}
                x1={x1}
                y1={y}
                x2={x2}
                y2={y}
                stroke="var(--chart-stop-highlight)"
                strokeWidth={4.2}
                strokeLinecap="butt"
              />
            )
          })}

          {/* Hover crosshair */}
          {hoveredSample && (
            <g pointerEvents="none">
              <line
                x1={xOf(hoveredSample.timeMinutes)}
                y1={PAD_TOP}
                x2={xOf(hoveredSample.timeMinutes)}
                y2={PAD_TOP + PLOT_H}
                stroke="var(--chart-crosshair)"
                strokeWidth={1.2}
                strokeDasharray="3 3"
              />
              <circle
                cx={xOf(hoveredSample.timeMinutes)}
                cy={yOf(hoveredSample.depthMeters)}
                r={4.5}
                fill="var(--chart-profile)"
                stroke="var(--bg-surface)"
                strokeWidth={1.5}
              />
              {hoveredSample.ceilingDepthMeters > 0.02 && (
                <circle
                  cx={xOf(hoveredSample.timeMinutes)}
                  cy={yOf(hoveredSample.ceilingDepthMeters)}
                  r={3.8}
                  fill="var(--chart-ceiling-stroke)"
                  stroke="var(--bg-surface)"
                  strokeWidth={1.2}
                />
              )}
            </g>
          )}
        </svg>
      </div>

      <div className="scrub-bar" id="profile-telemetry-bar">
        <span>
          {hoveredSample ? 'Inspecting runtime' : 'Surfacing state (hover chart to scrub)'}
        </span>
        <div className="scrub-metrics">
          <span>
            t = <strong>{activeSample.timeMinutes.toFixed(1)} min</strong>
          </span>
          <span>
            Depth: <strong>{activeSample.depthMeters.toFixed(1)} m</strong>
          </span>
          <span>
            Ceiling: <strong>{activeSample.ceilingDepthMeters.toFixed(1)} m</strong>
          </span>
          <span>
            GF99: <strong>{(activeSample.gf99 * 100).toFixed(0)}%</strong>
          </span>
          <span>
            Leading: <strong>#{activeSample.leadingCompartment}</strong>
          </span>
        </div>
      </div>

      <div className="compartment-strip" aria-label="16-Compartment Nitrogen Loading">
        <div className="compartment-strip-header">
          <span>
            16-Compartment N₂ Tension vs. Surface M-Value (at t ={' '}
            {activeSample.timeMinutes.toFixed(1)} min)
          </span>
          <span>
            Comp #{activeSample.leadingCompartment} ({compartments[activeSample.leadingCompartment - 1].n2HalfTime} min half-time) leading
          </span>
        </div>
        <div className="compartment-bars">
          {compartments.map((comp, idx) => {
            const pN2 = activeSample.compartmentN2Bar[idx]
            const surfaceM = comp.n2A + plan.input.surfacePressureBar / comp.n2B
            const ratio = Math.min(1, Math.max(0.06, pN2 / surfaceM))
            const isLeading = comp.index === activeSample.leadingCompartment
            return (
              <div
                key={comp.index}
                className={`comp-col${isLeading ? ' is-leading' : ''}`}
                title={`Compartment ${comp.label} (${comp.n2HalfTime} min): ${pN2.toFixed(2)} bar / ${surfaceM.toFixed(2)} bar surface M₀`}
              >
                <div className="comp-track">
                  <div
                    className="comp-fill"
                    style={{ height: `${(ratio * 100).toFixed(1)}%` }}
                  />
                </div>
                <span className="comp-idx">{comp.index}</span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
