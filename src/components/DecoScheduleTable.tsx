import { getCompartments } from '../engine/constants'
import type { DivePlanResult, SegmentType } from '../engine/zhl16c'

interface DecoScheduleTableProps {
  readonly plan: DivePlanResult
}

const SEGMENT_LABELS: Record<SegmentType, string> = {
  descent: 'Descent',
  bottom: 'Bottom',
  ascent: 'Ascent',
  deco_stop: 'Deco Stop',
}

export function DecoScheduleTable({ plan }: DecoScheduleTableProps) {
  const compartments = getCompartments(plan.input.variant)

  return (
    <div className="tables-grid">
      <section
        className="surface-panel"
        id="mandatory-deco-panel"
        aria-labelledby="deco-stops-heading"
      >
        <div className="panel-header">
          <h2 className="panel-title" id="deco-stops-heading">
            Mandatory Decompression Stops
          </h2>
          <span className="field-meta">Safety stops excluded</span>
        </div>

        {plan.decoStops.length === 0 ? (
          <div className="empty-deco-box" id="no-deco-message" role="status">
            <strong>No mandatory decompression stops required.</strong> Direct ascent from{' '}
            {plan.input.depthMeters} m at {plan.input.ascentRateMPerMin} m/min stays within{' '}
            GF High ({plan.input.gfHighPercent}%) at the surface. Discretionary safety stops
            are not added.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table" id="deco-stops-table">
              <thead>
                <tr>
                  <th>Stop</th>
                  <th className="num">Duration</th>
                  <th className="num">Runtime</th>
                  <th className="num">Target GF</th>
                  <th className="num">Lead Comp</th>
                </tr>
              </thead>
              <tbody>
                {plan.decoStops.map((stop) => {
                  const comp = compartments[stop.leadingCompartment - 1]
                  return (
                    <tr
                      key={`${stop.depthMeters}-${stop.arrivalRuntimeMinutes}`}
                      className="row-deco"
                    >
                      <td className="num">
                        <strong>{stop.depthMeters} m</strong>
                      </td>
                      <td className="num">{stop.durationMinutes} min</td>
                      <td className="num">
                        {stop.arrivalRuntimeMinutes.toFixed(1)} &rarr;{' '}
                        {stop.departureRuntimeMinutes.toFixed(1)} min
                      </td>
                      <td className="num">{(stop.targetGf * 100).toFixed(0)}%</td>
                      <td className="num">
                        #{comp.index} ({comp.n2HalfTime}m)
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        className="surface-panel"
        id="profile-segments-panel"
        aria-labelledby="segments-heading"
      >
        <div className="panel-header">
          <h2 className="panel-title" id="segments-heading">
            Complete Profile Schedule
          </h2>
          <span className="field-meta">
            Total {plan.totalRuntimeMinutes.toFixed(1)} min
          </span>
        </div>

        <div className="table-scroll">
          <table className="data-table" id="profile-segments-table">
            <thead>
              <tr>
                <th>Phase</th>
                <th className="num">Depth</th>
                <th className="num">Duration</th>
                <th className="num">Runtime</th>
              </tr>
            </thead>
            <tbody>
              {plan.segments.map((seg, idx) => {
                const isStop = seg.type === 'deco_stop'
                const depthStr =
                  Math.abs(seg.startDepthMeters - seg.endDepthMeters) < 1e-6
                    ? `${seg.endDepthMeters} m`
                    : `${seg.startDepthMeters} → ${seg.endDepthMeters} m`
                return (
                  <tr
                    key={`${seg.type}-${idx}`}
                    className={isStop ? 'row-deco' : undefined}
                  >
                    <td>
                      <span className="seg-tag">{SEGMENT_LABELS[seg.type]}</span>
                    </td>
                    <td className="num">{depthStr}</td>
                    <td className="num">{seg.durationMinutes.toFixed(1)} min</td>
                    <td className="num">{seg.endTimeMinutes.toFixed(1)} min</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
