import { useMemo, useState } from 'react'
import { DecoScheduleTable } from './components/DecoScheduleTable'
import { DiveProfileChart } from './components/DiveProfileChart'
import { NdlCurveView } from './components/NdlCurveView'
import { WATER_DENSITY_PRESETS } from './engine/constants'
import type { WaterDensityId, Zhl16Variant } from './engine/constants'
import { depthToPressure, planDive } from './engine/zhl16c'
import type { GfAnchorMode } from './engine/zhl16c'

type ActiveTab = 'profile' | 'ndl'

const GAS_PRESETS = [
  { label: 'Air 21%', o2: 21 },
  { label: 'EAN32', o2: 32 },
  { label: 'EAN36', o2: 36 },
  { label: 'EAN50', o2: 50 },
  { label: 'O₂ 100%', o2: 100 },
] as const

const GF_PRESETS = [
  { label: '30 / 70', low: 30, high: 70 },
  { label: '30 / 85', low: 30, high: 85 },
  { label: '40 / 85', low: 40, high: 85 },
  { label: '50 / 85', low: 50, high: 85 },
  { label: '100 / 100', low: 100, high: 100 },
] as const

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function formatMixLabel(o2Percent: number): string {
  if (o2Percent === 21) return 'Air (21% O₂)'
  if (o2Percent === 100) return 'Pure O₂ (100%)'
  return `EAN${o2Percent} (${o2Percent}% O₂)`
}

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('profile')
  const [depthMeters, setDepthMeters] = useState<number>(30)
  const [bottomTimeMinutes, setBottomTimeMinutes] = useState<number>(25)
  const [o2Percent, setO2Percent] = useState<number>(21)
  const [gfLowPercent, setGfLowPercent] = useState<number>(30)
  const [gfHighPercent, setGfHighPercent] = useState<number>(70)
  const [ascentRateMPerMin, setAscentRateMPerMin] = useState<number>(10)
  const [descentRateMPerMin, setDescentRateMPerMin] = useState<number>(20)
  const [decoStepSizeMeters, setDecoStepSizeMeters] = useState<number>(3)
  const [lastStopDepthMeters, setLastStopDepthMeters] = useState<number>(3)

  const [variant, setVariant] = useState<Zhl16Variant>('ZHL16C_1B')
  const [waterDensityId, setWaterDensityId] = useState<WaterDensityId>('salt_metric')
  const [gfAnchorMode, setGfAnchorMode] = useState<GfAnchorMode>('continuous_ceiling')

  const barPerMeter = WATER_DENSITY_PRESETS[waterDensityId].barPerMeter

  const handleInspectFromNdl = (depth: number, bottomTime: number) => {
    setDepthMeters(depth)
    setBottomTimeMinutes(bottomTime)
    setActiveTab('profile')
  }

  const plan = useMemo(
    () =>
      planDive({
        depthMeters,
        bottomTimeMinutes,
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
      bottomTimeMinutes,
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

  const bottomPressureBar = depthToPressure(
    depthMeters,
    plan.input.surfacePressureBar,
    barPerMeter,
  )

  const ppO2StatusClass =
    plan.bottomPpO2Bar > 1.6001
      ? ' is-high'
      : plan.bottomPpO2Bar > 1.4001
        ? ' is-elevated'
        : ''

  return (
    <div className="page-shell">
      <header className="site-header" id="site-header">
        <div className="brand-identity">
          <span className="brand-name">ZH-L16C Analysis</span>
          <span className="brand-tag">Bühlmann + GF &middot; Metric</span>
        </div>
        <a
          id="github-repo-link"
          className="repo-link"
          href="https://github.com/matthewlai/ZHL16C_Analysis"
          target="_blank"
          rel="noopener noreferrer"
        >
          View on GitHub
        </a>
      </header>

      <main className="main-content" id="main-content">
        <section className="intro-header" aria-labelledby="page-title">
          <h1 className="page-title" id="page-title">
            ZH-L16C Nitrox Workbench
          </h1>
          <p className="page-subtitle">
            Explore single-gas Nitrox decompression profiles, mandatory decompression stops
            (excluding discretionary safety stops), and no-decompression limits (NDL) across
            depth under Bühlmann ZH-L16C and gradient factors.
          </p>
        </section>

        <nav className="tab-bar" role="tablist" aria-label="Analysis Views">
          <button
            id="tab-btn-profile"
            role="tab"
            type="button"
            aria-selected={activeTab === 'profile'}
            aria-controls="tabpanel-profile"
            className={`tab-button${activeTab === 'profile' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            Dive Profile &amp; Deco Stops
          </button>
          <button
            id="tab-btn-ndl"
            role="tab"
            type="button"
            aria-selected={activeTab === 'ndl'}
            aria-controls="tabpanel-ndl"
            className={`tab-button${activeTab === 'ndl' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('ndl')}
          >
            NDL vs. Depth Curve
          </button>
        </nav>

        {activeTab === 'profile' ? (
          <div
            id="tabpanel-profile"
            role="tabpanel"
            aria-labelledby="tab-btn-profile"
          >
            <div className="planner-workspace">
          {/* Controls Sidebar */}
          <aside className="controls-panel" id="planner-controls" aria-label="Dive Parameters">
            {/* Group 1: Depth, Bottom Time, Nitrox Mix */}
            <div className="control-group">
              <div className="group-heading-row">
                <h2 className="group-heading">Dive &amp; Breathing Mix</h2>
                <span className="field-meta">{formatMixLabel(o2Percent)}</span>
              </div>

              <div className="field-block">
                <div className="field-header">
                  <label className="field-label" htmlFor="input-depth">
                    Target Depth
                  </label>
                  <span className="field-meta">{bottomPressureBar.toFixed(2)} bar abs</span>
                </div>
                <div className="slider-number-row">
                  <input
                    id="slider-depth"
                    className="range-input"
                    type="range"
                    min={3}
                    max={70}
                    step={1}
                    value={Math.min(70, depthMeters)}
                    onChange={(e) => setDepthMeters(Number(e.target.value))}
                  />
                  <div className="number-unit-wrap">
                    <input
                      id="input-depth"
                      className="number-input"
                      type="number"
                      min={1}
                      max={150}
                      step={1}
                      value={depthMeters}
                      onChange={(e) =>
                        setDepthMeters(clampNumber(Number(e.target.value), 1, 150, depthMeters))
                      }
                    />
                    <span className="unit-suffix">m</span>
                  </div>
                </div>
              </div>

              <div className="field-block">
                <div className="field-header">
                  <label className="field-label" htmlFor="input-bottom-time">
                    Bottom Time
                  </label>
                  <span className="field-meta">
                    {plan.descentDurationMinutes.toFixed(1)}m desc +{' '}
                    {plan.flatBottomDurationMinutes.toFixed(1)}m at depth
                  </span>
                </div>
                <div className="slider-number-row">
                  <input
                    id="slider-bottom-time"
                    className="range-input"
                    type="range"
                    min={2}
                    max={120}
                    step={1}
                    value={Math.min(120, bottomTimeMinutes)}
                    onChange={(e) => setBottomTimeMinutes(Number(e.target.value))}
                  />
                  <div className="number-unit-wrap">
                    <input
                      id="input-bottom-time"
                      className="number-input"
                      type="number"
                      min={1}
                      max={600}
                      step={1}
                      value={bottomTimeMinutes}
                      onChange={(e) =>
                        setBottomTimeMinutes(
                          clampNumber(Number(e.target.value), 1, 600, bottomTimeMinutes),
                        )
                      }
                    />
                    <span className="unit-suffix">min</span>
                  </div>
                </div>
                {plan.bottomTimeClampedToDescent && (
                  <div className="inline-note" id="descent-clamp-note">
                    Descent takes {plan.descentDurationMinutes.toFixed(1)} min at{' '}
                    {descentRateMPerMin} m/min; ascent begins upon reaching bottom.
                  </div>
                )}
              </div>

              <div className="field-block">
                <div className="field-header">
                  <label className="field-label" htmlFor="input-o2">
                    Nitrox O₂
                  </label>
                  <span className="field-meta">{100 - o2Percent}% N₂</span>
                </div>
                <div className="slider-number-row">
                  <input
                    id="slider-o2"
                    className="range-input"
                    type="range"
                    min={21}
                    max={100}
                    step={1}
                    value={o2Percent}
                    onChange={(e) => setO2Percent(Number(e.target.value))}
                  />
                  <div className="number-unit-wrap">
                    <input
                      id="input-o2"
                      className="number-input"
                      type="number"
                      min={21}
                      max={100}
                      step={1}
                      value={o2Percent}
                      onChange={(e) =>
                        setO2Percent(clampNumber(Number(e.target.value), 21, 100, o2Percent))
                      }
                    />
                    <span className="unit-suffix">%</span>
                  </div>
                </div>
                <div className="preset-row" role="group" aria-label="Gas Mix Presets">
                  {GAS_PRESETS.map((preset) => (
                    <button
                      key={preset.o2}
                      id={`preset-gas-${preset.o2}`}
                      type="button"
                      className={`preset-btn${o2Percent === preset.o2 ? ' is-active' : ''}`}
                      onClick={() => setO2Percent(preset.o2)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className={`ppo2-readout${ppO2StatusClass}`} id="ppo2-readout">
                  <span>Bottom ppO₂: {plan.bottomPpO2Bar.toFixed(2)} bar</span>
                  <span>
                    MOD 1.4: {plan.mod14Meters.toFixed(1)} m &middot; 1.6:{' '}
                    {plan.mod16Meters.toFixed(1)} m
                  </span>
                </div>
              </div>
            </div>

            {/* Group 2: Gradient Factors */}
            <div className="control-group">
              <div className="group-heading-row">
                <h2 className="group-heading">Gradient Factors</h2>
                <span className="field-meta">
                  GF {gfLowPercent}/{gfHighPercent}
                </span>
              </div>

              <div className="field-block">
                <div className="field-header">
                  <label className="field-label" htmlFor="input-gf-low">
                    GF Low
                  </label>
                  <span className="field-meta">Controls first stop depth</span>
                </div>
                <div className="slider-number-row">
                  <input
                    id="slider-gf-low"
                    className="range-input"
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    value={gfLowPercent}
                    onChange={(e) => setGfLowPercent(Number(e.target.value))}
                  />
                  <div className="number-unit-wrap">
                    <input
                      id="input-gf-low"
                      className="number-input"
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={gfLowPercent}
                      onChange={(e) =>
                        setGfLowPercent(
                          clampNumber(Number(e.target.value), 1, 100, gfLowPercent),
                        )
                      }
                    />
                    <span className="unit-suffix">%</span>
                  </div>
                </div>
              </div>

              <div className="field-block">
                <div className="field-header">
                  <label className="field-label" htmlFor="input-gf-high">
                    GF High
                  </label>
                  <span className="field-meta">Controls NDL &amp; surfacing M-value</span>
                </div>
                <div className="slider-number-row">
                  <input
                    id="slider-gf-high"
                    className="range-input"
                    type="range"
                    min={30}
                    max={100}
                    step={5}
                    value={gfHighPercent}
                    onChange={(e) => setGfHighPercent(Number(e.target.value))}
                  />
                  <div className="number-unit-wrap">
                    <input
                      id="input-gf-high"
                      className="number-input"
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      value={gfHighPercent}
                      onChange={(e) =>
                        setGfHighPercent(
                          clampNumber(Number(e.target.value), 1, 100, gfHighPercent),
                        )
                      }
                    />
                    <span className="unit-suffix">%</span>
                  </div>
                </div>
              </div>

              <div className="preset-row" role="group" aria-label="Gradient Factor Presets">
                {GF_PRESETS.map((preset) => {
                  const active =
                    gfLowPercent === preset.low && gfHighPercent === preset.high
                  return (
                    <button
                      key={preset.label}
                      id={`preset-gf-${preset.low}-${preset.high}`}
                      type="button"
                      className={`preset-btn${active ? ' is-active' : ''}`}
                      onClick={() => {
                        setGfLowPercent(preset.low)
                        setGfHighPercent(preset.high)
                      }}
                    >
                      {preset.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Group 3: Rates & Stop Geometry */}
            <div className="control-group">
              <div className="group-heading-row">
                <h2 className="group-heading">Rates &amp; Stop Geometry</h2>
                <span className="field-meta">Metric</span>
              </div>

              <div className="compact-grid-2">
                <div className="field-block">
                  <label className="field-label" htmlFor="input-ascent-rate">
                    Ascent Rate
                  </label>
                  <div className="number-unit-wrap">
                    <input
                      id="input-ascent-rate"
                      className="number-input"
                      type="number"
                      min={1}
                      max={30}
                      step={1}
                      value={ascentRateMPerMin}
                      onChange={(e) =>
                        setAscentRateMPerMin(
                          clampNumber(Number(e.target.value), 1, 60, ascentRateMPerMin),
                        )
                      }
                    />
                    <span className="unit-suffix">m/min</span>
                  </div>
                </div>

                <div className="field-block">
                  <label className="field-label" htmlFor="input-descent-rate">
                    Descent Rate
                  </label>
                  <div className="number-unit-wrap">
                    <input
                      id="input-descent-rate"
                      className="number-input"
                      type="number"
                      min={1}
                      max={60}
                      step={1}
                      value={descentRateMPerMin}
                      onChange={(e) =>
                        setDescentRateMPerMin(
                          clampNumber(Number(e.target.value), 1, 60, descentRateMPerMin),
                        )
                      }
                    />
                    <span className="unit-suffix">m/min</span>
                  </div>
                </div>

                <div className="field-block">
                  <label className="field-label" htmlFor="input-step-size">
                    Deco Step Size
                  </label>
                  <div className="number-unit-wrap">
                    <input
                      id="input-step-size"
                      className="number-input"
                      type="number"
                      min={0.5}
                      max={15}
                      step={0.5}
                      value={decoStepSizeMeters}
                      onChange={(e) =>
                        setDecoStepSizeMeters(
                          clampNumber(Number(e.target.value), 0.5, 30, decoStepSizeMeters),
                        )
                      }
                    />
                    <span className="unit-suffix">m</span>
                  </div>
                </div>

                <div className="field-block">
                  <label className="field-label" htmlFor="input-last-stop">
                    Last Stop Depth
                  </label>
                  <div className="number-unit-wrap">
                    <input
                      id="input-last-stop"
                      className="number-input"
                      type="number"
                      min={1}
                      max={15}
                      step={0.5}
                      value={lastStopDepthMeters}
                      onChange={(e) =>
                        setLastStopDepthMeters(
                          clampNumber(Number(e.target.value), 1, 30, lastStopDepthMeters),
                        )
                      }
                    />
                    <span className="unit-suffix">m</span>
                  </div>
                </div>
              </div>

              <div className="preset-row" role="group" aria-label="Last Stop Quick Select">
                {[3, 6].map((depth) => (
                  <button
                    key={depth}
                    id={`preset-last-stop-${depth}m`}
                    type="button"
                    className={`preset-btn${lastStopDepthMeters === depth ? ' is-active' : ''}`}
                    onClick={() => setLastStopDepthMeters(depth)}
                  >
                    Last Stop {depth} m
                  </button>
                ))}
              </div>
            </div>

            {/* Group 4: Advanced Model Constants */}
            <details className="advanced-details" id="advanced-model-settings">
              <summary className="advanced-summary">
                Model Variants &amp; Physical Constants
              </summary>
              <div className="advanced-body">
                <div className="field-block">
                  <label className="field-label" htmlFor="select-variant">
                    Compartment 1 Half-Time Set
                  </label>
                  <select
                    id="select-variant"
                    className="select-input"
                    value={variant}
                    onChange={(e) => setVariant(e.target.value as Zhl16Variant)}
                  >
                    <option value="ZHL16C_1B">
                      1b — 4.0 min N₂ (OSTC / MultiDeco / Shearwater)
                    </option>
                    <option value="ZHL16C_1">
                      1 — 5.0 min N₂ (Subsurface / MV-Plan)
                    </option>
                  </select>
                </div>

                <div className="field-block">
                  <label className="field-label" htmlFor="select-water-density">
                    Hydrostatic Water Conversion
                  </label>
                  <select
                    id="select-water-density"
                    className="select-input"
                    value={waterDensityId}
                    onChange={(e) => setWaterDensityId(e.target.value as WaterDensityId)}
                  >
                    {Object.values(WATER_DENSITY_PRESETS).map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field-block">
                  <label className="field-label" htmlFor="select-gf-anchor">
                    GF Low Ramp Anchor
                  </label>
                  <select
                    id="select-gf-anchor"
                    className="select-input"
                    value={gfAnchorMode}
                    onChange={(e) => setGfAnchorMode(e.target.value as GfAnchorMode)}
                  >
                    <option value="continuous_ceiling">
                      Continuous Ceiling (Subsurface / Shearwater)
                    </option>
                    <option value="first_stop">
                      First Grid Stop (Erik Baker / MultiDeco)
                    </option>
                  </select>
                </div>
              </div>
            </details>
          </aside>

          {/* Results & Profile Visualization */}
          <div className="results-column">
            <section
              className="metrics-strip"
              id="summary-metrics"
              aria-label="Computed Dive Summary"
            >
              <div className="metric-cell">
                <span className="metric-label">Decompression</span>
                <span
                  id="metric-deco-status"
                  className={`obligation-badge ${plan.isDecoRequired ? 'is-deco' : 'is-ndl'}`}
                >
                  {plan.isDecoRequired
                    ? `${plan.totalDecoStopMinutes} min Deco`
                    : 'No-Deco (NDL)'}
                </span>
                <span className="metric-sub">
                  {plan.isDecoRequired
                    ? `${plan.decoStops.length} mandatory ${plan.decoStops.length === 1 ? 'stop' : 'stops'}`
                    : '0 mandatory stops'}
                </span>
              </div>

              <div className="metric-cell">
                <span className="metric-label">Total Runtime</span>
                <span className="metric-value" id="metric-runtime">
                  {plan.totalRuntimeMinutes.toFixed(1)} min
                </span>
                <span className="metric-sub">
                  TTS {plan.ttsMinutes.toFixed(1)} min from bottom
                </span>
              </div>

              <div className="metric-cell">
                <span className="metric-label">NDL at {depthMeters} m</span>
                <span className="metric-value" id="metric-ndl">
                  {plan.isUnlimitedNdl ? 'Unlimited' : `${plan.ndlMinutes} min`}
                </span>
                <span className="metric-sub">
                  {plan.isUnlimitedNdl
                    ? 'Within surface M-value'
                    : `At GF High ${gfHighPercent}%`}
                </span>
              </div>

              <div className="metric-cell">
                <span className="metric-label">First Stop</span>
                <span className="metric-value" id="metric-first-stop">
                  {plan.firstStopDepthMeters !== null
                    ? `${plan.firstStopDepthMeters} m`
                    : '—'}
                </span>
                <span className="metric-sub">
                  Step {decoStepSizeMeters} m &middot; Last {lastStopDepthMeters} m
                </span>
              </div>

              <div className="metric-cell">
                <span className="metric-label">Surfacing GF</span>
                <span className="metric-value" id="metric-surface-gf">
                  {(plan.surfaceGf * 100).toFixed(0)}%
                </span>
                <span className="metric-sub">
                  Comp #{plan.surfaceLeadingCompartment} leading
                </span>
              </div>
            </section>

              <DiveProfileChart plan={plan} />

              <DecoScheduleTable plan={plan} />
            </div>
          </div>
          </div>
        ) : (
          <div
            id="tabpanel-ndl"
            role="tabpanel"
            aria-labelledby="tab-btn-ndl"
          >
            <NdlCurveView
              o2Percent={o2Percent}
              onChangeO2Percent={setO2Percent}
              gfHighPercent={gfHighPercent}
              onChangeGfHighPercent={setGfHighPercent}
              ascentRateMPerMin={ascentRateMPerMin}
              onChangeAscentRateMPerMin={setAscentRateMPerMin}
              descentRateMPerMin={descentRateMPerMin}
              onChangeDescentRateMPerMin={setDescentRateMPerMin}
              variant={variant}
              onChangeVariant={setVariant}
              waterDensityId={waterDensityId}
              onChangeWaterDensityId={setWaterDensityId}
              onInspectInProfilePlanner={handleInspectFromNdl}
            />
          </div>
        )}

        <details className="notes-panel" id="coefficient-notes">
          <summary className="notes-summary">
            Where Published ZH-L16C Implementations Agree &amp; Disagree on Coefficients
          </summary>
          <div className="notes-content">
            <div>
              <h3>1. Compartment 1 (5.0 min) vs. 1b (4.0 min)</h3>
              <p>
                Bühlmann&apos;s <em>Tauchmedizin</em> lists 17 rows (<code>1</code>,{' '}
                <code>1b</code>, and <code>2</code>–<code>16</code>). Dive computers using
                16 slots choose either <code>1b</code> (4.0 min N₂,{' '}
                <code>a = 1.2599</code>, <code>b = 0.5050</code> — used by OSTC,
                Shearwater, MultiDeco, DecoTengu) or <code>1</code> (5.0 min N₂,{' '}
                <code>a = 1.1696</code>, <code>b = 0.5578</code> — used by Subsurface and
                MV-Plan). Both are selectable in the model settings above.
              </p>
            </div>
            <div>
              <h3>2. Complete Consensus on Compartments 2–16</h3>
              <p>
                All major vetted ZH-L16C engines agree identically on N₂ half-times (8.0 to
                635.0 min), <code>a</code> intercepts, and <code>b</code> slopes for
                compartments 2 through 16. Note that ZH-L16C lowers <code>a</code> values
                in compartments 5–15 compared to ZH-L16A (experimental) and ZH-L16B
                (printed dive tables) for real-time dive computer margin.
              </p>
            </div>
            <div>
              <h3>3. Secondary Physical &amp; Ramp Conventions</h3>
              <p>
                Small 1–2 min schedule differences across planners typically stem from
                water density (<code>0.1000</code> vs. EN 13319 <code>0.09985</code> vs.
                freshwater <code>0.0981 bar/m</code>), surface air N₂ fraction (
                <code>0.79</code> vs. Subsurface&apos;s <code>0.781</code>), and whether{' '}
                <code>GF Low</code> anchors at the continuous ceiling or the first grid
                stop.
              </p>
            </div>
          </div>
        </details>

        <section
          className="disclaimer-box"
          id="safety-disclaimer"
          aria-label="Safety Disclaimer"
        >
          <strong>Educational &amp; Analytical Use Only:</strong> This simulator visualizes
          mathematical decompression models and compares table behaviors. Never use
          profiles or schedules computed by this website to plan real-world dives.
        </section>
      </main>

      <footer className="site-footer" id="site-footer">
        <span>ZH-L16C Analysis &middot; Licensed under Apache-2.0</span>
        <span>
          Validated against Subsurface, MultiDeco &amp; DecoTengu reference profiles
        </span>
      </footer>
    </div>
  )
}

export default App
