"use client"

import { useState, type ComponentType } from "react"

import type { ChartTheme, LegendItem } from "./chart-card"
import {
  AxisCrosshair,
  BASE_Y,
  COL_W,
  COL_X,
  ChartGrid,
  ChartTooltip,
  INK,
  LABEL,
  LaneGapMarkers,
  LaneGapZones,
  LaneSplit,
  PLOT_LEFT,
  PLOT_RIGHT,
  PinStatus,
  SLOT_START,
  labelsBetweenColumns,
  linearPath,
  mixHex,
  nearestIndex,
  nearestMarkerKey,
  slotLabelEmphasis,
  slotPointer,
  smoothPath,
  smoothSegments,
  topRoundedBar,
  useLaneLayout,
  usePinnedSelection,
  useValueScale,
  ValueAxisRange,
  yFor,
  type AxisMarker,
  type CrosshairColumn,
  type TooltipRow,
  type ViewBoxRect,
} from "./chart-kit"
import { choiceOf, isOn, type ChartSetting, type ChartSettingsValues } from "./chart-settings"

type ChartProps = { settings: ChartSettingsValues }

/** Pointer snapped to a column / sample index, plus the raw pointer y. */
type Pointer = { index: number; y: number }

/* Palette shared across charts */
const GREEN = "#00A74F"
const AMBER = "#D9A21B"
const BLUE_SOFT = "#E0F1FC"
const VIOLET_SOFT = "#F0E4FB"
const QUARTERS = ["JAN 23", "APR 23", "JUL 23", "OCT 23", "JAN 24", "APR 24", "JUL 24"]
const DIMMED = 0.35
const fade = (dimmed: boolean) => ({ opacity: dimmed ? DIMMED : 1, transition: "opacity 150ms ease" })

/** Pinned items plus the hovered one (if it isn't already pinned), in pin order. */
function focusedItems<T>(pinned: T[], hovered: T | null): T[] {
  return hovered === null || pinned.includes(hovered) ? pinned : [...pinned, hovered]
}

/**
 * Crosshair columns for every focused item. The hovered column marks the marker
 * nearest the pointer as active; pinned columns keep all markers solid.
 */
function crosshairColumns<T>(
  pinned: T[],
  hovered: T | null,
  pointerY: number | null,
  describe: (item: T) => Pick<CrosshairColumn, "key" | "x" | "label" | "markers">
): CrosshairColumn[] {
  return focusedItems(pinned, hovered).map((item) => {
    const column = describe(item)
    const isHovered = item === hovered && pointerY !== null
    return {
      ...column,
      pinned: pinned.includes(item),
      activeKey: isHovered && pointerY !== null ? nearestMarkerKey(column.markers, pointerY) : null,
    }
  })
}

/* ------------------------------------------------------------------ */
/* 1. Data Completeness — premium bars with loss-ratio error bars      */
/* ------------------------------------------------------------------ */

const completenessData = [
  { premium: 28, lossRatio: 56, low: 51, high: 63, reconciled: false },
  { premium: 35, lossRatio: 64, low: 56, high: 74, reconciled: false },
  { premium: 44, lossRatio: 45, low: 38, high: 48, reconciled: false },
  { premium: 65, lossRatio: 38, low: 33, high: 43, reconciled: false },
  { premium: 56, lossRatio: 44, low: 39, high: 48, reconciled: true },
  { premium: 47, lossRatio: 51, low: 38, high: 54, reconciled: true },
  { premium: 36, lossRatio: 14, low: 8, high: 17, reconciled: true },
]

const completenessSettings: ChartSetting[] = [
  { kind: "toggle", key: "bars", label: "Premium bars", defaultValue: true },
  { kind: "toggle", key: "bands", label: "Confidence bands", defaultValue: true },
  {
    kind: "choice",
    key: "status",
    label: "Highlight",
    options: [
      { value: "all", label: "All" },
      { value: "pending", label: "Pending" },
      { value: "reconciled", label: "Reconciled" },
    ],
    defaultValue: "all",
  },
]

/** Premium reads off the left axis; loss ratio and its band off the right axis. */
function completenessMarkers(
  d: (typeof completenessData)[number],
  showBars: boolean,
  showBands: boolean,
  yPremium: (value: number) => number,
  yRatio: (value: number) => number
): AxisMarker[] {
  const color = d.reconciled ? GREEN : AMBER
  const bandTint = d.reconciled ? "#BDEBD0" : "#F6E3B0"
  const markers: AxisMarker[] = []
  if (showBars) {
    markers.push({
      key: "premium",
      side: "left",
      y: yPremium(d.premium),
      value: `$${d.premium}M`,
      color: d.reconciled ? "#E6D2F8" : "#CDE8FA",
    })
  }
  markers.push({
    key: "lossRatio",
    side: "right",
    y: yRatio(d.lossRatio),
    value: `${d.lossRatio}%`,
    color,
    textColor: "#fff",
  })
  if (showBands) {
    markers.push({ key: "high", side: "right", y: yRatio(d.high), value: `${d.high}%`, color: bandTint })
    markers.push({ key: "low", side: "right", y: yRatio(d.low), value: `${d.low}%`, color: bandTint })
  }
  return markers
}

/** Bar width follows its slot (≈96 by default), capped so focused bars don't balloon. */
const completenessBarWidth = (slotWidth: number) => Math.min(slotWidth * 0.86, 200)

function DataCompletenessChart({ settings }: ChartProps) {
  const [pointer, setPointer] = useState<Pointer | null>(null)
  const { pinned, toggle, clear, focused: focusMode, toggleFocus } = usePinnedSelection<number>()
  const showBars = isOn(settings, "bars")
  const showBands = isOn(settings, "bands")
  const status = choiceOf(settings, "status")
  const hovered = pointer?.index ?? null
  const focused = focusedItems(pinned, hovered)

  // Focus mode turns pinned quarters into large, centred lanes (animated).
  const layout = useLaneLayout({
    count: completenessData.length,
    pinned,
    active: focusMode,
    rangeStart: SLOT_START,
    rangeEnd: SLOT_START + completenessData.length * COL_W,
  })
  const { centers, widths } = layout
  // Focus also expands both value axes to the pinned quarters (bars keep their zero baseline).
  const premiumScale = useValueScale({
    max: 130,
    values: showBars ? pinned.map((i) => completenessData[i].premium) : [],
    active: focusMode,
    includeZero: true,
  })
  const ratioScale = useValueScale({
    max: 100,
    values: pinned.flatMap((i) => {
      const d = completenessData[i]
      return showBands ? [d.lossRatio, d.low, d.high] : [d.lossRatio]
    }),
    active: focusMode,
  })

  const isDimmed = (i: number) => {
    const matchesStatus = status === "all" || (status === "reconciled") === completenessData[i].reconciled
    return !matchesStatus || (focused.length > 0 && !focused.includes(i))
  }

  const columns = crosshairColumns(pinned, hovered, pointer?.y ?? null, (index) => ({
    key: String(index),
    x: centers[index],
    label: QUARTERS[index],
    markers: completenessMarkers(completenessData[index], showBars, showBands, premiumScale.y, ratioScale.y),
  }))

  return (
    <>
      <ChartGrid
        topLabels={QUARTERS.map((text, i) => ({ text, x: centers[i], emphasis: slotLabelEmphasis(widths[i]) }))}
        gridX={[COL_X[0], ...centers]}
        leftLabel="EARNED PREMIUM"
        rightLabel="LOSS RATIO"
        bottomLabel="DEVELOPMENT LAG (MONTHS)"
        onPointerMove={(point) => setPointer(slotPointer(point, centers, widths))}
        onPointerLeave={() => setPointer(null)}
        onChartClick={(point) => {
          const target = slotPointer(point, centers, widths)
          if (target) toggle(target.index)
        }}
      >
        <LaneGapZones gaps={layout.gaps} progress={layout.progress} />
        {showBars &&
          completenessData.map((d, i) => {
            const barWidth = completenessBarWidth(widths[i])
            const x = centers[i] - barWidth / 2
            const width = Math.min(barWidth, PLOT_RIGHT - x)
            const top = premiumScale.y(d.premium)
            return (
              <path
                key={`bar-${i}`}
                d={topRoundedBar(x, top, width, BASE_Y - top)}
                fill={d.reconciled ? VIOLET_SOFT : BLUE_SOFT}
                style={fade(isDimmed(i))}
              />
            )
          })}
        {completenessData.map((d, i) => {
          const cx = centers[i]
          const color = d.reconciled ? GREEN : AMBER
          return (
            <g key={`point-${i}`} style={fade(isDimmed(i))}>
              {showBands && (
                <line
                  x1={cx}
                  x2={cx}
                  y1={ratioScale.y(d.high)}
                  y2={ratioScale.y(d.low)}
                  stroke={color}
                  strokeWidth={4}
                  strokeLinecap="round"
                />
              )}
              <circle cx={cx} cy={ratioScale.y(d.lossRatio)} r={7} fill={color} stroke="#fff" strokeWidth={2} />
            </g>
          )
        })}

        <LaneGapMarkers gaps={layout.gaps} progress={layout.progress} noun="quarters" />
        {showBars && (
          <ValueAxisRange scale={premiumScale} side="left" format={(value) => `$${Math.round(value)}M`} />
        )}
        <ValueAxisRange scale={ratioScale} side="right" format={(value) => `${Math.round(value)}%`} />
        {columns.length > 0 && <AxisCrosshair columns={columns} />}
      </ChartGrid>
      <PinStatus
        count={pinned.length}
        hovering={pointer !== null}
        onClear={clear}
        focus={{ active: focusMode, onToggle: toggleFocus, total: completenessData.length }}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 2. Right Edge — loss-ratio curves over thin premium bars            */
/* ------------------------------------------------------------------ */

const reportedCurve = [
  0.03, 0.05, 0.09, 0.2, 0.45, 0.66, 0.8, 0.81, 0.8, 0.79, 0.795, 0.785, 0.77, 0.69, 0.79, 0.795, 0.81, 0.84, 0.86,
  0.89, 0.89,
]
const paidCurve = [
  0.03, 0.04, 0.07, 0.15, 0.28, 0.38, 0.44, 0.445, 0.435, 0.43, 0.435, 0.43, 0.425, 0.39, 0.43, 0.435, 0.445, 0.46,
  0.47, 0.485, 0.485,
]
const edgePremium = [35, 35, 35, 35, 35, 35, 35]
const REPORTED_LINE = "#CFE7F8"
const REPORTED_POINT = "#9AD5F7"
const PAID_LINE = "#DDBDF6"
const PAID_POINT = "#C39BF2"
const CURVE_START = PLOT_LEFT + 4
const CURVE_STEP = (PLOT_RIGHT - CURVE_START) / (reportedCurve.length - 1)
/** Default-layout x → sample-index space, so fixed decorations (bars, labels, grid) follow the zoom. */
const sampleIndexOfX = (x: number) => (x - CURVE_START) / CURVE_STEP

const rightEdgeSettings: ChartSetting[] = [
  { kind: "toggle", key: "points", label: "Points", defaultValue: true },
  { kind: "toggle", key: "reported", label: "Reported line", defaultValue: true },
  { kind: "toggle", key: "paid", label: "Paid line", defaultValue: true },
  { kind: "toggle", key: "bars", label: "Premium bars", defaultValue: true },
  {
    kind: "choice",
    key: "curve",
    label: "Line style",
    options: [
      { value: "smooth", label: "Smooth" },
      { value: "linear", label: "Linear" },
    ],
    defaultValue: "smooth",
  },
]

function RightEdgeChart({ settings }: ChartProps) {
  const [pointer, setPointer] = useState<Pointer | null>(null)
  const { pinned, toggle, clear, focused: focusMode, toggleFocus } = usePinnedSelection<number>()
  const showPoints = isOn(settings, "points")
  const showReported = isOn(settings, "reported")
  const showPaid = isOn(settings, "paid")
  const showBars = isOn(settings, "bars")
  const drawPath = choiceOf(settings, "curve") === "linear" ? linearPath : smoothPath

  // Focus mode turns pinned samples into large, centred lanes; the rest compress into gaps.
  const layout = useLaneLayout({
    count: reportedCurve.length,
    pinned,
    active: focusMode,
    rangeStart: CURVE_START - CURVE_STEP / 2,
    rangeEnd: PLOT_RIGHT + CURVE_STEP / 2,
  })
  const xOf = layout.xAt
  // Outside the lanes, marks fade once focus mode is (mostly) in.
  const isContext = (index: number) => layout.progress > 0.5 && !layout.inLane(index)
  // Focus also expands the loss-ratio axis to the pinned samples' values.
  const ratioScale = useValueScale({
    max: 1,
    values: pinned.flatMap((i) => [
      ...(showReported ? [reportedCurve[i]] : []),
      ...(showPaid ? [paidCurve[i]] : []),
    ]),
    active: focusMode,
  })

  const reported = reportedCurve.map((v, i): [number, number] => [xOf(i), ratioScale.y(v)])
  const paid = paidCurve.map((v, i): [number, number] => [xOf(i), ratioScale.y(v)])
  const sampleXs = reported.map(([x]) => x)

  // Snap to the nearest (laid-out) sample.
  const samplePointer = ({ x, y }: { x: number; y: number }): Pointer | null => {
    if (y > BASE_Y + 10 || x < CURVE_START - CURVE_STEP / 2 || x > PLOT_RIGHT + CURVE_STEP / 2) return null
    const index = nearestIndex(sampleXs, x, Infinity)
    return index === null ? null : { index, y }
  }

  // Loss ratios read off the right axis; premium off the left axis when the sample sits on a bar.
  const sampleMarkers = (i: number): AxisMarker[] => {
    const markers: AxisMarker[] = []
    if (showReported) {
      markers.push({
        key: "reported",
        side: "right",
        y: reported[i][1],
        value: `${Math.round(reportedCurve[i] * 100)}%`,
        color: REPORTED_POINT,
      })
    }
    if (showPaid) {
      markers.push({
        key: "paid",
        side: "right",
        y: paid[i][1],
        value: `${Math.round(paidCurve[i] * 100)}%`,
        color: PAID_POINT,
      })
    }
    const barIndex = edgePremium.findIndex((_, bar) => Math.abs(sampleIndexOfX(COL_X[bar + 1]) - i) < 0.5)
    if (showBars && barIndex !== -1) {
      markers.push({
        key: "premium",
        side: "left",
        y: yFor(edgePremium[barIndex], 100),
        value: `$${edgePremium[barIndex]}M`,
        color: GREEN,
        textColor: "#fff",
      })
    }
    return markers
  }

  const columns = crosshairColumns(pinned, pointer?.index ?? null, pointer?.y ?? null, (index) => ({
    key: String(index),
    x: reported[index][0],
    label: `LAG ${index * 3} MO`,
    markers: sampleMarkers(index),
  }))

  return (
    <>
      <ChartGrid
        topLabels={labelsBetweenColumns(QUARTERS).map((label) => {
          const index = sampleIndexOfX(label.x)
          return { ...label, x: xOf(index), emphasis: layout.inLane(index) ? 1 : 1 - layout.progress }
        })}
        gridX={COL_X.map((x) => xOf(sampleIndexOfX(x)))}
        leftLabel="EARNED PREMIUM"
        rightLabel="LOSS RATIO"
        bottomLabel="DEVELOPMENT LAG (MONTHS)"
        onPointerMove={(point) => setPointer(samplePointer(point))}
        onPointerLeave={() => setPointer(null)}
        onChartClick={(point) => {
          const target = samplePointer(point)
          if (target) toggle(target.index)
        }}
      >
        <LaneGapZones gaps={layout.gaps} progress={layout.progress} />

        {showBars &&
          edgePremium.map((premium, i) => {
            const index = sampleIndexOfX(COL_X[i + 1])
            const top = yFor(premium, 100)
            return (
              <rect
                key={`bar-${i}`}
                x={xOf(index) - 9}
                y={top}
                width={18}
                height={BASE_Y - top}
                rx={9}
                fill={GREEN}
                style={fade(isContext(index))}
              />
            )
          })}

        {/* Lines: full strength inside the lanes, faded (and compressed) in the gaps */}
        <LaneSplit lanes={layout.lanes} progress={layout.progress}>
          {showReported && (
            <path data-anim-line d={drawPath(reported)} fill="none" stroke={REPORTED_LINE} strokeWidth={2} />
          )}
          {showPaid && <path data-anim-line d={drawPath(paid)} fill="none" stroke={PAID_LINE} strokeWidth={2} />}
        </LaneSplit>

        {showPoints &&
          [
            { visible: showReported, points: reported, color: REPORTED_POINT, key: "reported" },
            { visible: showPaid, points: paid, color: PAID_POINT, key: "paid" },
          ].map(
            (series) =>
              series.visible && (
                <g key={series.key}>
                  {series.points.map(([x, y], i) => (
                    <circle
                      key={i}
                      cx={x}
                      cy={y}
                      r={3.5}
                      fill="#fff"
                      stroke={series.color}
                      strokeWidth={1.5}
                      style={fade(isContext(i))}
                    />
                  ))}
                </g>
              )
          )}

        <LaneGapMarkers gaps={layout.gaps} progress={layout.progress} noun="samples" />
        <ValueAxisRange scale={ratioScale} side="right" format={(value) => `${Math.round(value * 100)}%`} />
        {columns.length > 0 && <AxisCrosshair columns={columns} />}
      </ChartGrid>
      <PinStatus
        count={pinned.length}
        hovering={pointer !== null}
        onClear={clear}
        focus={{ active: focusMode, onToggle: toggleFocus, total: reportedCurve.length }}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 3. Loss Triangle — heatmap of cumulative loss ratio                 */
/* (categorical grid without a value axis, so it keeps a tooltip)      */
/* ------------------------------------------------------------------ */

const ACCIDENT_QUARTERS = ["1Q23", "2Q23", "3Q23", "4Q23", "1Q24", "2Q24", "3Q24"]
const DEV_LAGS = ["3 MO", "6 MO", "9 MO", "12 MO", "15 MO", "18 MO", "21 MO"]
const ultimateByQuarter = [64, 58, 69, 55, 61, 66, 57]
const developmentPattern = [0.34, 0.53, 0.68, 0.79, 0.87, 0.93, 0.98]
const HEAT_LOW = "#F4EDFE"
const HEAT_HIGH = "#9C6CF2"
const TRIANGLE_TOP = 70
const TRIANGLE_ROW_H = (BASE_Y - TRIANGLE_TOP) / ACCIDENT_QUARTERS.length
const CELL_GAP = 6

const cumulativeLossRatio = (row: number, col: number) => Math.round(ultimateByQuarter[row] * developmentPattern[col])
const incrementalLossRatio = (row: number, col: number) =>
  col === 0 ? cumulativeLossRatio(row, 0) : cumulativeLossRatio(row, col) - cumulativeLossRatio(row, col - 1)

/** Cells are identified by "row:col" so they can be pinned. */
const cellKey = (row: number, col: number) => `${row}:${col}`
const parseCellKey = (key: string) => {
  const [row, col] = key.split(":").map(Number)
  return { row, col }
}
const cellRect = (row: number, col: number): ViewBoxRect => ({
  x: COL_X[col] + CELL_GAP / 2,
  y: TRIANGLE_TOP + row * TRIANGLE_ROW_H + CELL_GAP / 2,
  width: COL_W - CELL_GAP,
  height: TRIANGLE_ROW_H - CELL_GAP,
})

const lossTriangleSettings: ChartSetting[] = [
  { kind: "toggle", key: "values", label: "Cell values", defaultValue: true },
  { kind: "toggle", key: "focus", label: "Row & column focus", defaultValue: true },
  {
    kind: "choice",
    key: "metric",
    label: "Metric",
    options: [
      { value: "cumulative", label: "Cumulative" },
      { value: "incremental", label: "Incremental" },
    ],
    defaultValue: "cumulative",
  },
]

function LossTriangleChart({ settings }: ChartProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const { pinned, toggle, clear } = usePinnedSelection<string>()
  const showValues = isOn(settings, "values")
  const focus = isOn(settings, "focus")
  const incremental = choiceOf(settings, "metric") === "incremental"
  const focused = focusedItems(pinned, hovered)

  const cellValue = (row: number, col: number) =>
    incremental ? incrementalLossRatio(row, col) : cumulativeLossRatio(row, col)
  const cellIntensity = (value: number) =>
    Math.min(1, Math.max(0, incremental ? value / 24 : (value - 15) / 55))
  const cellFill = (row: number, col: number) => mixHex(HEAT_LOW, HEAT_HIGH, cellIntensity(cellValue(row, col)))
  const formatValue = (value: number) => (incremental ? `+${value} pts` : `${value}%`)

  // With pins: only pinned + hovered cells stay bright. Without: hovered row & column (if enabled).
  const isDimmed = (row: number, col: number) => {
    if (pinned.length > 0) return !focused.includes(cellKey(row, col))
    if (!focus || hovered === null) return false
    const target = parseCellKey(hovered)
    return target.row !== row && target.col !== col
  }

  const focusedCells = focused.map(parseCellKey)
  const tooltip = (() => {
    if (focusedCells.length === 0) return null
    if (focusedCells.length === 1) {
      const { row, col } = focusedCells[0]
      const rows: TooltipRow[] = [
        { label: "Cumulative LR", value: `${cumulativeLossRatio(row, col)}%`, color: cellFill(row, col) },
        { label: "Incremental", value: `+${incrementalLossRatio(row, col)} pts` },
        { label: "Developed", value: `${Math.round(developmentPattern[col] * 100)}%` },
        { label: "Ultimate (est.)", value: `${ultimateByQuarter[row]}%` },
      ]
      return { title: `${ACCIDENT_QUARTERS[row]} · ${DEV_LAGS[col]}`, rows }
    }
    // Comparison view: one row per pinned (and hovered) cell.
    const rows: TooltipRow[] = focusedCells.map(({ row, col }) => ({
      label: `${ACCIDENT_QUARTERS[row]} · ${DEV_LAGS[col]}`,
      value: formatValue(cellValue(row, col)),
      color: cellFill(row, col),
    }))
    if (focusedCells.length === 2) {
      const [a, b] = focusedCells
      const difference = cellValue(b.row, b.col) - cellValue(a.row, a.col)
      rows.push({ label: "Difference", value: `${difference >= 0 ? "+" : "−"}${Math.abs(difference)} pts` })
    }
    return { title: `Comparing ${focusedCells.length} cells`, rows }
  })()

  return (
    <>
      <ChartGrid
        topLabels={labelsBetweenColumns(DEV_LAGS)}
        leftLabel="ACCIDENT QUARTER"
        rightLabel="LOSS RATIO"
        bottomLabel="DEVELOPMENT LAG (MONTHS)"
        horizontalLines={false}
      >
        {ACCIDENT_QUARTERS.map((quarter, row) => {
          const y = TRIANGLE_TOP + row * TRIANGLE_ROW_H
          const rowIsFocused = focusedCells.some((cell) => cell.row === row)
          return (
            <g key={quarter}>
              <text
                x={88}
                y={y + TRIANGLE_ROW_H / 2 + 4}
                fontSize={11}
                fill={rowIsFocused ? INK : LABEL}
                textAnchor="middle"
                data-avoid="box"
              >
                {quarter}
              </text>
              {developmentPattern.map((_, col) => {
                // Only the upper-left triangle is observed so far.
                if (row + col >= ACCIDENT_QUARTERS.length) return null
                const key = cellKey(row, col)
                const value = cellValue(row, col)
                const intensity = cellIntensity(value)
                const rect = cellRect(row, col)
                const isPinned = pinned.includes(key)
                return (
                  <g key={col} style={fade(isDimmed(row, col))}>
                    <rect
                      x={rect.x}
                      y={rect.y}
                      width={rect.width}
                      height={rect.height}
                      rx={8}
                      className="cursor-pointer"
                      fill={cellFill(row, col)}
                      stroke={focused.includes(key) ? INK : "none"}
                      strokeWidth={isPinned ? 2.5 : 1.5}
                      vectorEffect="non-scaling-stroke"
                      data-avoid="box"
                      onPointerEnter={() => setHovered(key)}
                      onPointerLeave={() => setHovered(null)}
                      onClick={() => toggle(key)}
                    />
                    {showValues && (
                      <text
                        x={COL_X[col] + COL_W / 2}
                        y={y + TRIANGLE_ROW_H / 2 + 5}
                        fontSize={14}
                        textAnchor="middle"
                        pointerEvents="none"
                        fill={intensity > 0.6 ? "#fff" : "#8B79A6"}
                      >
                        {incremental ? `+${value}` : `${value}%`}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          )
        })}
      </ChartGrid>

      {tooltip && (
        <ChartTooltip
          anchors={focusedCells.map(({ row, col }) => cellRect(row, col))}
          title={tooltip.title}
          rows={tooltip.rows}
        />
      )}
      <PinStatus count={pinned.length} hovering={hovered !== null} onClear={clear} />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 4. Reserve Range — P10–P90 floating ranges per line of business     */
/* ------------------------------------------------------------------ */

const reserveData = [
  { line: "AUTO", low: 38, high: 72, indicated: 55, booked: 58 },
  { line: "GL", low: 45, high: 88, indicated: 64, booked: 61 },
  { line: "WC", low: 30, high: 52, indicated: 41, booked: 44 },
  { line: "PROP", low: 20, high: 46, indicated: 31, booked: 30 },
  { line: "CYBER", low: 28, high: 80, indicated: 49, booked: 57 },
  { line: "MED MAL", low: 50, high: 92, indicated: 70, booked: 66 },
  { line: "D&O", low: 34, high: 68, indicated: 48, booked: 52 },
]
/* Blue range scale — contrasts with the yellow frame and its pills. */
const RANGE_FILL = "#E1F1FC"
const RANGE_P90 = "#6CBCF0"
const RANGE_P10 = "#A8D7F6"

const reserveSettings: ChartSetting[] = [
  { kind: "toggle", key: "indicated", label: "Indicated ticks", defaultValue: true },
  { kind: "toggle", key: "booked", label: "Booked points", defaultValue: true },
  {
    kind: "choice",
    key: "order",
    label: "Order",
    options: [
      { value: "default", label: "Default" },
      { value: "width", label: "Widest" },
      { value: "booked", label: "Booked" },
    ],
    defaultValue: "default",
  },
]

/** P10/P90 read off the right axis ("P10 – P90"); indicated and booked off the left axis. */
function reserveMarkers(
  d: (typeof reserveData)[number],
  showIndicated: boolean,
  showBooked: boolean,
  y: (value: number) => number
): AxisMarker[] {
  const markers: AxisMarker[] = [
    { key: "p90", side: "right", y: y(d.high), value: `$${d.high}M`, color: RANGE_P90 },
    { key: "p10", side: "right", y: y(d.low), value: `$${d.low}M`, color: RANGE_P10 },
  ]
  if (showIndicated) {
    markers.push({
      key: "indicated",
      side: "left",
      y: y(d.indicated),
      value: `$${d.indicated}M`,
      color: INK,
      textColor: "#fff",
    })
  }
  if (showBooked) {
    markers.push({
      key: "booked",
      side: "left",
      y: y(d.booked),
      value: `$${d.booked}M`,
      color: GREEN,
      textColor: "#fff",
    })
  }
  return markers
}

/** Range band width follows its slot (≈40 by default), capped when focused. */
const reserveBandWidth = (slotWidth: number) => Math.min(slotWidth * 0.36, 96)

function ReserveRangeChart({ settings }: ChartProps) {
  const [pointer, setPointer] = useState<Pointer | null>(null)
  // Pinned by line of business so pins survive re-ordering.
  const { pinned, toggle, clear, focused: focusMode, toggleFocus } = usePinnedSelection<string>()
  const showIndicated = isOn(settings, "indicated")
  const showBooked = isOn(settings, "booked")
  const order = choiceOf(settings, "order")

  const rows = [...reserveData]
  if (order === "width") rows.sort((a, b) => b.high - b.low - (a.high - a.low))
  if (order === "booked") rows.sort((a, b) => b.booked - a.booked)
  const indexOfLine = (line: string) => rows.findIndex((d) => d.line === line)

  // Focus mode turns pinned lines of business into large, centred lanes (animated).
  const layout = useLaneLayout({
    count: rows.length,
    pinned: pinned.map(indexOfLine),
    active: focusMode,
    rangeStart: SLOT_START,
    rangeEnd: SLOT_START + rows.length * COL_W,
  })
  const { centers, widths } = layout
  // Focus also expands the reserve axis (shared by both sides) to the pinned lines' values.
  const reserveScale = useValueScale({
    max: 100,
    values: pinned.flatMap((line) => {
      const d = rows[indexOfLine(line)]
      return [d.low, d.high, ...(showIndicated ? [d.indicated] : []), ...(showBooked ? [d.booked] : [])]
    }),
    active: focusMode,
  })
  const yOf = reserveScale.y

  const hoveredLine = pointer ? rows[pointer.index].line : null
  const focused = focusedItems(pinned, hoveredLine)

  const columns = crosshairColumns(pinned, hoveredLine, pointer?.y ?? null, (line) => {
    const index = indexOfLine(line)
    return {
      key: line,
      x: centers[index],
      label: line,
      markers: reserveMarkers(rows[index], showIndicated, showBooked, yOf),
    }
  })

  return (
    <>
      <ChartGrid
        topLabels={rows.map((d, i) => ({ text: d.line, x: centers[i], emphasis: slotLabelEmphasis(widths[i]) }))}
        gridX={[COL_X[0], ...centers]}
        leftLabel="RESERVE ($M)"
        rightLabel="P10 – P90"
        bottomLabel="LINE OF BUSINESS"
        onPointerMove={(point) => setPointer(slotPointer(point, centers, widths))}
        onPointerLeave={() => setPointer(null)}
        onChartClick={(point) => {
          const target = slotPointer(point, centers, widths)
          if (target) toggle(rows[target.index].line)
        }}
      >
        <LaneGapZones gaps={layout.gaps} progress={layout.progress} />
        {rows.map((d, i) => {
          const cx = centers[i]
          const width = reserveBandWidth(widths[i])
          const tickWidth = width * 0.7
          const yHigh = yOf(d.high)
          const yLow = yOf(d.low)
          const yIndicated = yOf(d.indicated)
          return (
            <g key={d.line} style={fade(focused.length > 0 && !focused.includes(d.line))}>
              <rect x={cx - width / 2} y={yHigh} width={width} height={yLow - yHigh} rx={width / 2} fill={RANGE_FILL} />
              {showIndicated && (
                <rect x={cx - tickWidth / 2} y={yIndicated - 1.5} width={tickWidth} height={3} rx={1.5} fill={INK} />
              )}
              {showBooked && (
                <circle
                  cx={cx}
                  cy={yOf(d.booked)}
                  r={Math.min(7, widths[i] * 0.28)}
                  fill={GREEN}
                  stroke="#fff"
                  strokeWidth={2}
                />
              )}
            </g>
          )
        })}

        <LaneGapMarkers gaps={layout.gaps} progress={layout.progress} noun="lines of business" />
        <ValueAxisRange scale={reserveScale} side="left" format={(value) => `$${Math.round(value)}M`} />
        <ValueAxisRange scale={reserveScale} side="right" format={(value) => `$${Math.round(value)}M`} />
        {columns.length > 0 && <AxisCrosshair columns={columns} />}
      </ChartGrid>
      <PinStatus
        count={pinned.length}
        hovering={pointer !== null}
        onClear={clear}
        focus={{ active: focusMode, onToggle: toggleFocus, total: rows.length }}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* 5. Premium Mix — stacked areas with an axis crosshair               */
/* ------------------------------------------------------------------ */

const MIX_QUARTERS = ["1Q23", "2Q23", "3Q23", "4Q23", "1Q24", "2Q24", "3Q24", "4Q24"]
const mixSeries = [
  { key: "property", name: "Property", color: "#9AD5F7", values: [22, 24, 25, 27, 26, 29, 31, 33] },
  { key: "casualty", name: "Casualty", color: "#CEB5FB", values: [30, 33, 37, 40, 44, 47, 52, 55] },
  { key: "specialty", name: "Specialty", color: "#64EF99", values: [8, 10, 11, 14, 16, 19, 21, 25] },
]

const premiumMixSettings: ChartSetting[] = [
  ...mixSeries.map((series): ChartSetting => ({
    kind: "toggle",
    key: series.key,
    label: series.name,
    defaultValue: true,
  })),
  {
    kind: "choice",
    key: "scale",
    label: "Values",
    options: [
      { value: "absolute", label: "Absolute ($M)" },
      { value: "share", label: "Share (%)" },
    ],
    defaultValue: "absolute",
  },
]

function PremiumMixChart({ settings }: ChartProps) {
  const [pointer, setPointer] = useState<Pointer | null>(null)
  const { pinned, toggle, clear, focused: focusMode, toggleFocus } = usePinnedSelection<number>()
  const asShare = choiceOf(settings, "scale") === "share"
  const visibleSeries = mixSeries.filter((series) => isOn(settings, series.key))
  const max = asShare ? 100 : 130

  // Focus mode turns pinned quarters into large, centred lanes; the rest compress into gaps.
  const rangeStart = COL_X[0] - COL_W / 2
  const rangeEnd = COL_X[COL_X.length - 1] + COL_W / 2
  const layout = useLaneLayout({ count: MIX_QUARTERS.length, pinned, active: focusMode, rangeStart, rangeEnd })
  const quarterXs = layout.centers

  // Snap to the nearest (laid-out) quarter.
  const quarterPointer = ({ x, y }: { x: number; y: number }): Pointer | null => {
    if (y < 20 || y > BASE_Y + 10 || x < rangeStart || x > rangeEnd) return null
    const index = nearestIndex(quarterXs, x, Infinity)
    return index === null ? null : { index, y }
  }

  // Per-quarter totals of the visible series, used for the share view.
  const totals = MIX_QUARTERS.map((_, i) => visibleSeries.reduce((sum, series) => sum + series.values[i], 0))

  // Running totals so each series sits on top of the previous one.
  let baseline = MIX_QUARTERS.map(() => 0)
  const stacks = visibleSeries.map((series) => {
    const values = series.values.map((v, i) => (asShare ? (v / totals[i]) * 100 : v))
    const lower = baseline
    const upper = lower.map((value, i) => value + values[i])
    baseline = upper
    return { ...series, lower, upper }
  })

  // Focus also expands the value axis to the layer edges at the pinned quarters.
  const valueScale = useValueScale({
    max,
    values: pinned.flatMap((i) => stacks.map((stack) => stack.upper[i])),
    active: focusMode,
  })

  const layers = stacks.map((stack) => {
    const upperPoints = stack.upper.map((v, i) => [quarterXs[i], valueScale.y(v)] as [number, number])
    const lowerPoints = stack.lower.map((v, i) => [quarterXs[i], valueScale.y(v)] as [number, number]).reverse()
    const area = `${smoothPath(upperPoints)} L${lowerPoints[0][0]},${lowerPoints[0][1]}${smoothSegments(lowerPoints)} Z`
    return { ...stack, area, line: smoothPath(upperPoints) }
  })

  // Every layer edge at a focused quarter reads off the left axis.
  const columns: CrosshairColumn[] =
    layers.length === 0
      ? []
      : crosshairColumns(pinned, pointer?.index ?? null, pointer?.y ?? null, (index) => ({
          key: String(index),
          x: quarterXs[index],
          label: MIX_QUARTERS[index],
          markers: layers.map(
            (layer): AxisMarker => ({
              key: layer.key,
              side: "left",
              y: valueScale.y(layer.upper[index]),
              value: asShare ? `${Math.round(layer.upper[index])}%` : `$${Math.round(layer.upper[index])}M`,
              color: layer.color,
            })
          ),
        }))
  const activeLayerKey = columns.find((column) => column.activeKey !== null)?.activeKey ?? null

  return (
    <>
      <ChartGrid
        topLabels={MIX_QUARTERS.map((text, i) => ({
          text,
          x: quarterXs[i],
          emphasis: slotLabelEmphasis(layout.widths[i]),
        }))}
        gridX={quarterXs}
        leftLabel="WRITTEN PREMIUM"
        rightLabel={asShare ? "SHARE (%)" : "USD (M)"}
        bottomLabel="UNDERWRITING QUARTER"
        onPointerMove={(point) => setPointer(quarterPointer(point))}
        onPointerLeave={() => setPointer(null)}
        onChartClick={(point) => {
          const target = quarterPointer(point)
          if (target) toggle(target.index)
        }}
      >
        <LaneGapZones gaps={layout.gaps} progress={layout.progress} />

        {/* Areas: full strength inside the lanes, faded (and compressed) in the gaps */}
        <LaneSplit lanes={layout.lanes} progress={layout.progress}>
          {layers.map((layer) => (
            <g key={layer.key}>
              <path
                data-anim-area
                d={layer.area}
                fill={layer.color}
                fillOpacity={activeLayerKey && activeLayerKey !== layer.key ? 0.18 : 0.35}
                style={{ transition: "fill-opacity 150ms ease" }}
              />
              <path data-anim-line d={layer.line} fill="none" stroke={layer.color} strokeWidth={2.5} />
            </g>
          ))}
        </LaneSplit>

        <LaneGapMarkers gaps={layout.gaps} progress={layout.progress} noun="quarters" />
        <ValueAxisRange
          scale={valueScale}
          side="left"
          format={(value) => (asShare ? `${Math.round(value)}%` : `$${Math.round(value)}M`)}
        />
        {columns.length > 0 && <AxisCrosshair columns={columns} />}
      </ChartGrid>
      <PinStatus
        count={pinned.length}
        hovering={pointer !== null}
        onClear={clear}
        focus={{ active: focusMode, onToggle: toggleFocus, total: MIX_QUARTERS.length }}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export type ChartDefinition = {
  id: string
  title: string
  description: string
  theme: ChartTheme
  legend: LegendItem[]
  settings: ChartSetting[]
  Chart: ComponentType<ChartProps>
}

export const charts: ChartDefinition[] = [
  {
    id: "data-completeness",
    title: "Data Completeness",
    description:
      "Latest loss ratios with confidence bands (amber points: pending, green points: reconciled) against booked and audited premium (bars) in the triangle.",
    theme: { frame: "#B3E4FB", pill: "#8FCDF0" },
    legend: [
      { label: "Pending", color: AMBER },
      { label: "Reconciled", color: GREEN },
      { label: "Booked premium", color: "#CDE8FA" },
      { label: "Audited premium", color: "#E6D2F8" },
    ],
    settings: completenessSettings,
    Chart: DataCompletenessChart,
  },
  {
    id: "right-edge",
    title: "Right Edge",
    description:
      "Latest loss ratios (violet line/points: paid, blue line/points: reported) and premium (green bars) in the triangle.",
    theme: { frame: "#5CE38F", pill: "#45CF7A" },
    legend: [
      { label: "Earned premium", color: GREEN },
      { label: "Paid loss ratio", color: "#D9B8F5" },
      { label: "Reported loss ratio", color: "#CFE7F8" },
    ],
    settings: rightEdgeSettings,
    Chart: RightEdgeChart,
  },
  {
    id: "loss-triangle",
    title: "Loss Triangle",
    description:
      "Cumulative paid loss ratio by accident quarter (rows) and development lag (columns); deeper violet marks faster-emerging losses.",
    theme: { frame: "#D8C6FC", pill: "#C3A8F7" },
    legend: [
      { label: "Low", color: "#EADCFD" },
      { label: "Mid", color: "#C3A2F7" },
      { label: "High", color: HEAT_HIGH },
    ],
    settings: lossTriangleSettings,
    Chart: LossTriangleChart,
  },
  {
    id: "reserve-range",
    title: "Reserve Range",
    description:
      "Reserve estimates by line of business (blue bands: P10–P90 range, dark ticks: indicated, green points: booked) at the latest valuation.",
    theme: { frame: "#F7DF84", pill: "#EDCC58" },
    legend: [
      { label: "P10 – P90 range", color: RANGE_P90 },
      { label: "Indicated", color: INK },
      { label: "Booked", color: GREEN },
    ],
    settings: reserveSettings,
    Chart: ReserveRangeChart,
  },
  {
    id: "premium-mix",
    title: "Premium Mix",
    description:
      "Written premium stacked by line of business (blue: property, violet: casualty, green: specialty) across underwriting quarters.",
    theme: { frame: "#FFC8B4", pill: "#F7AC92" },
    legend: mixSeries.map((series) => ({ label: series.name, color: series.color })),
    settings: premiumMixSettings,
    Chart: PremiumMixChart,
  },
]
