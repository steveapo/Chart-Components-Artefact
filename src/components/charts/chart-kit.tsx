"use client"

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, ZoomInAreaIcon, ZoomOutAreaIcon } from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"

/**
 * Shared SVG coordinate system for every chart. All charts render into a
 * 1000 × 520 viewBox that scales uniformly with the card width.
 */
export const VIEW_W = 1000
export const VIEW_H = 520

/** Vertical grid lines (column edges). */
export const COL_X = [110, 222, 334, 446, 558, 670, 782, 894]
export const COL_W = 112

/** Plot bounds. */
export const PLOT_LEFT = 66
export const PLOT_RIGHT = 934
export const PLOT_TOP = 100
export const BASE_Y = 470
export const PLOT_H = BASE_Y - PLOT_TOP

/** Horizontal grid lines in the lower part of the plot. */
const H_LINES = [470, 392.5, 315, 237.5, 160]

export const INK = "#17211A"
export const LABEL = "#C4C4C4"

/**
 * Top axis label. `emphasis` (0–1, default 1) cross-fades the text into a small
 * dot — used for columns that are compressed in focus mode.
 */
export type TopLabel = { x: number; text: string; emphasis?: number }

/** Labels centred between column lines (inspiration style). */
export function labelsBetweenColumns(texts: string[]): TopLabel[] {
  return texts.map((text, i) => ({ x: COL_X[i] + COL_W / 2, text }))
}

/** Labels centred on column lines, starting at `startIndex`. */
export function labelsOnColumns(texts: string[], startIndex = 1): TopLabel[] {
  return texts.map((text, i) => ({ x: COL_X[i + startIndex], text }))
}

/** Map a value in [0, max] to a y coordinate inside the plot. */
export function yFor(value: number, max: number) {
  return BASE_Y - (value / max) * PLOT_H
}

/** Bar path with rounded top corners and a flat base. */
export function topRoundedBar(x: number, y: number, w: number, h: number, r = 6) {
  const radius = Math.min(r, w / 2, h)
  return `M${x},${y + h} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + w - radius} Q${x + w},${y} ${x + w},${y + radius} V${y + h} Z`
}

type Point = [number, number]

/** Catmull-Rom → cubic Bézier segments (without the leading move command). */
export function smoothSegments(points: Point[]) {
  let d = ""
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2[0]},${p2[1].toFixed(2)}`
  }
  return d
}

export function smoothPath(points: Point[]) {
  if (points.length === 0) return ""
  return `M${points[0][0]},${points[0][1].toFixed(2)}${smoothSegments(points)}`
}

/** Straight segments between points. */
export function linearPath(points: Point[]) {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y.toFixed(2)}`).join(" ")
}

/** Linear interpolation between two hex colours. */
export function mixHex(from: string, to: string, t: number) {
  const a = parseInt(from.slice(1), 16)
  const b = parseInt(to.slice(1), 16)
  const channel = (shift: number) => {
    const ca = (a >> shift) & 255
    const cb = (b >> shift) & 255
    return Math.round(ca + (cb - ca) * t)
  }
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}

/* ------------------------------------------------------------------ */
/* Focus mode — layouts that scale up pinned items                     */
/* ------------------------------------------------------------------ */

const FOCUS_DURATION = 260 // ms

/**
 * Animate an array of numbers towards `target` (ease-out cubic). Every chart
 * layout value (lane boundaries, focus progress) runs through this, so bars, lines,
 * labels and crosshairs all move together. Honours prefers-reduced-motion.
 */
export function useAnimatedNumbers(target: number[]) {
  const [current, setCurrent] = useState(target)
  const currentRef = useRef(target)
  const targetKey = target.join(",")

  useEffect(() => {
    const from = currentRef.current
    const to = targetKey.split(",").map(Number)
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (from.length !== to.length || reduceMotion) {
      currentRef.current = to
      setCurrent(to)
      return
    }
    const startedAt = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / FOCUS_DURATION)
      const eased = 1 - Math.pow(1 - progress, 3)
      const next = from.map((value, i) => value + (to[i] - value) * eased)
      currentRef.current = next
      setCurrent(next)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [targetKey])

  return current
}

/* ------------------------------------------------------------------ */
/* Lane layout — pinned items become large, centred comparison lanes   */
/* ------------------------------------------------------------------ */
/*
 * Every chart lays its items (columns, samples, quarters) out left to right.
 * The layout is described by item boundaries: boundary j is the left edge of
 * item j, so item i spans [boundaries[i], boundaries[i + 1]].
 *
 * Default: evenly spaced.
 * Focus:   each pinned item gets an equal-width lane; the lanes sit as a centred
 *          group between two equal outer margins. Unpinned items collapse into
 *          gaps exactly where they are — before, between and after the lanes —
 *          so the chart still shows what's hidden and where.
 */

/** Left edge of the first slot for categorical charts (slot centres default to COL_X[1..]). */
export const SLOT_START = COL_X[1] - COL_W / 2
/** Outer margins on both sides in focus mode — equal, so the lanes stay centred. */
const OUTER_GAP_W = 56
/** Width of a gap between two lanes that hides at least one item. */
const INNER_GAP_W = 44

function evenBoundaries(count: number, rangeStart: number, rangeEnd: number) {
  const step = (rangeEnd - rangeStart) / count
  return Array.from({ length: count + 1 }, (_, j) => rangeStart + j * step)
}

function laneBoundaries(count: number, pins: number[], rangeStart: number, rangeEnd: number) {
  const innerGaps = pins.slice(1).map((pin, k): number => (pin - pins[k] - 1 > 0 ? INNER_GAP_W : 0))
  const laneWidth =
    (rangeEnd - rangeStart - 2 * OUTER_GAP_W - innerGaps.reduce((sum, width) => sum + width, 0)) / pins.length

  const boundaries: number[] = new Array(count + 1)
  let cursor = rangeStart
  // Spread boundaries first..last evenly across the next `width` units.
  const place = (first: number, last: number, width: number) => {
    const spans = last - first
    for (let j = first; j <= last; j++) boundaries[j] = spans === 0 ? cursor : cursor + ((j - first) / spans) * width
    cursor += width
  }

  place(0, pins[0], OUTER_GAP_W) // items before the first lane
  pins.forEach((pin, k) => {
    place(pin, pin + 1, laneWidth) // the lane itself
    if (k < pins.length - 1) place(pin + 1, pins[k + 1], innerGaps[k]) // items between lanes
  })
  place(pins[pins.length - 1] + 1, count, OUTER_GAP_W) // items after the last lane
  return boundaries
}

/** Runs of unpinned items: before, between and after the pins. */
function hiddenRuns(count: number, pins: number[]) {
  if (pins.length === 0) return []
  const edges = [-1, ...pins, count]
  return edges
    .slice(1)
    .map((edge, k) => ({ from: edges[k] + 1, to: edge - 1 }))
    .filter((run) => run.to >= run.from)
}

export type LaneGap = { from: number; to: number; count: number; left: number; right: number }
export type Lane = { index: number; left: number; right: number }

/**
 * Animated lane layout. `progress` goes 0 → 1 as focus mode eases in, and all
 * positions (centres, widths, lanes, gaps, xAt) come from the animated boundaries,
 * so marks, labels, grid lines and crosshairs move as one.
 */
export function useLaneLayout({
  count,
  pinned,
  active,
  rangeStart,
  rangeEnd,
}: {
  count: number
  pinned: number[]
  active: boolean
  rangeStart: number
  rangeEnd: number
}) {
  const pins = [...new Set(pinned)].filter((index) => index >= 0 && index < count).sort((a, b) => a - b)
  const useLanes = active && pins.length > 0
  const target = useLanes
    ? [1, ...laneBoundaries(count, pins, rangeStart, rangeEnd)]
    : [0, ...evenBoundaries(count, rangeStart, rangeEnd)]
  const [progress, ...boundaries] = useAnimatedNumbers(target)

  const centers = Array.from({ length: count }, (_, i) => (boundaries[i] + boundaries[i + 1]) / 2)
  const widths = Array.from({ length: count }, (_, i) => boundaries[i + 1] - boundaries[i])

  /** x for a fractional item index (item i is centred on index i). */
  const xAt = (index: number) => {
    const t = index + 0.5
    const j = Math.min(count - 1, Math.max(0, Math.floor(t)))
    return boundaries[j] + (boundaries[j + 1] - boundaries[j]) * (t - j)
  }
  const inLane = (index: number) => pins.some((pin) => Math.abs(index - pin) <= 0.5)
  const lanes: Lane[] = pins.map((pin) => ({ index: pin, left: boundaries[pin], right: boundaries[pin + 1] }))
  const gaps: LaneGap[] = hiddenRuns(count, pins).map(({ from, to }) => ({
    from,
    to,
    count: to - from + 1,
    left: boundaries[from],
    right: boundaries[to + 1],
  }))

  return { progress, centers, widths, xAt, inLane, lanes, gaps }
}

/* ------------------------------------------------------------------ */
/* Value scale — focus mode also expands the y-axis to the pinned data */
/* ------------------------------------------------------------------ */

/** Out-of-range context marks are pinned to the plot edges instead of escaping it. */
const VALUE_CLAMP_TOP = PLOT_TOP - 40

/** Largest 1 / 2 / 5 × 10ⁿ step no bigger than a twentieth of the full axis. */
function niceStep(max: number) {
  const raw = max / 20
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
  return [5, 2, 1].map((multiple) => multiple * magnitude).find((step) => step <= raw) ?? magnitude
}

/** Padded, step-rounded domain around the focused values, kept inside [0, max]. */
function focusDomain(values: number[], max: number, includeZero: boolean): [number, number] {
  const low = Math.min(...values)
  const high = Math.max(...values)
  const pad = Math.max((high - low) * 0.2, max * 0.06)
  const step = niceStep(max)
  let lo = includeZero ? 0 : Math.max(0, Math.floor((low - pad) / step) * step)
  if (lo < max * 0.1) lo = 0 // don't break the axis for a sliver
  const hi = Math.min(max, Math.ceil((high + pad) / step) * step)
  return [lo, hi]
}

/**
 * Animated value axis. By default it spans [0, max]; in focus mode it expands to
 * the pinned items' values (padded), so their differences fill the plot height.
 * `includeZero` keeps the zero baseline (bars) so bar heights stay proportional.
 * Runs on the same easing as the lane layout, so x and y zoom together.
 */
export function useValueScale({
  max,
  values,
  active,
  includeZero = false,
}: {
  max: number
  values: number[]
  active: boolean
  includeZero?: boolean
}) {
  const zoom = active && values.length > 0
  const [targetLo, targetHi] = zoom ? focusDomain(values, max, includeZero) : [0, max]
  const [progress, lo, hi] = useAnimatedNumbers([zoom ? 1 : 0, targetLo, targetHi])
  const y = (value: number) =>
    Math.min(BASE_Y, Math.max(VALUE_CLAMP_TOP, BASE_Y - ((value - lo) / (hi - lo)) * PLOT_H))
  return { y, lo, hi, max, progress }
}

export type ValueScale = ReturnType<typeof useValueScale>

/**
 * Shows the zoomed domain on a value axis: the top and bottom values, plus an
 * axis-break glyph when the axis no longer starts at zero.
 */
export function ValueAxisRange({
  scale,
  side,
  format,
}: {
  scale: ValueScale
  side: "left" | "right"
  format: (value: number) => string
}) {
  const truncated = scale.lo > scale.max * 0.001
  const zoomed = truncated || scale.hi < scale.max * 0.999
  if (!zoomed || scale.progress <= 0.01) return null
  const x = side === "left" ? PLOT_LEFT - 6 : PLOT_RIGHT + 6
  const breakX = side === "left" ? PLOT_LEFT - 18 : PLOT_RIGHT + 18
  return (
    <g pointerEvents="none" opacity={scale.progress} fontSize={11} fill="#8A8A85" textAnchor={side === "left" ? "end" : "start"}>
      <text x={x} y={PLOT_TOP + 4}>
        {format(scale.hi)}
      </text>
      <text x={x} y={BASE_Y - 4}>
        {format(scale.lo)}
      </text>
      {truncated && (
        <path
          d={`M${breakX - 6},${BASE_Y - 22} L${breakX + 6},${BASE_Y - 28} M${breakX - 6},${BASE_Y - 16} L${breakX + 6},${BASE_Y - 22}`}
          fill="none"
          stroke="#B8B8B2"
          strokeWidth={1.5}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  )
}

/** Label text fades out as its slot narrows, leaving a dot for compressed items. */
export function slotLabelEmphasis(width: number) {
  return Math.min(1, Math.max(0, (width - 60) / 40))
}

/** Snap a pointer to the slot under it. */
export function slotPointer(
  { x, y }: { x: number; y: number },
  centers: number[],
  widths: number[]
): { index: number; y: number } | null {
  if (y > BASE_Y + 10) return null
  const index = centers.findIndex((center, i) => Math.abs(x - center) <= widths[i] / 2)
  return index === -1 ? null : { index, y }
}

/** Nearest item x to the pointer, within `maxDistance` viewBox units. */
export function nearestIndex(positions: number[], x: number, maxDistance: number) {
  let nearest = -1
  positions.forEach((position, i) => {
    if (Math.abs(position - x) <= maxDistance && (nearest === -1 || Math.abs(position - x) < Math.abs(positions[nearest] - x))) {
      nearest = i
    }
  })
  return nearest === -1 ? null : nearest
}

const GAP_ZONE_TOP = 54
/** Opacity of marks outside the lanes once focus mode is fully in. */
const CONTEXT_OPACITY = 0.35

/** Faint backdrop behind each gap — render before the chart marks. */
export function LaneGapZones({ gaps, progress }: { gaps: LaneGap[]; progress: number }) {
  if (progress <= 0.01) return null
  return (
    <g pointerEvents="none" opacity={progress}>
      {gaps.map((gap) => (
        <rect
          key={gap.from}
          x={gap.left + 2}
          y={GAP_ZONE_TOP}
          width={Math.max(0, gap.right - gap.left - 4)}
          height={BASE_Y - GAP_ZONE_TOP}
          rx={8}
          fill="#F6F6F3"
        />
      ))}
    </g>
  )
}

/**
 * Gap markers — render after the chart marks: a "+N" pill saying how many items
 * are compressed there, and an axis-break glyph on the baseline.
 */
export function LaneGapMarkers({ gaps, progress, noun }: { gaps: LaneGap[]; progress: number; noun: string }) {
  if (progress <= 0.01) return null
  return (
    <g pointerEvents="none" opacity={progress}>
      {gaps.map((gap) => {
        const cx = (gap.left + gap.right) / 2
        const text = `+${gap.count}`
        const pillWidth = text.length * 7.5 + 14
        return (
          <g key={gap.from} aria-label={`${gap.count} hidden ${noun}`}>
            <rect
              x={cx - pillWidth / 2}
              y={GAP_ZONE_TOP + 6}
              width={pillWidth}
              height={20}
              rx={10}
              fill="#fff"
              stroke="#E2E2DC"
              vectorEffect="non-scaling-stroke"
            />
            <text x={cx} y={GAP_ZONE_TOP + 20} fontSize={11} textAnchor="middle" fill="#8A8A85">
              {text}
            </text>
            {/* Axis break on the baseline */}
            <rect x={cx - 9} y={BASE_Y - 3} width={18} height={6} fill="#fff" />
            <path
              d={`M${cx - 7},${BASE_Y + 6} L${cx - 2},${BASE_Y - 6} M${cx + 2},${BASE_Y + 6} L${cx + 7},${BASE_Y - 6}`}
              fill="none"
              stroke="#B8B8B2"
              strokeWidth={1.5}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )
      })}
    </g>
  )
}

/**
 * Split continuous marks (lines, areas) into lanes vs context while focused:
 * the children render full-strength inside the lanes and faded outside them.
 * A mask + clip pair is used (instead of overlaying a copy) so semi-transparent
 * areas never double up. Without focus the children render once, untouched.
 */
export function LaneSplit({ lanes, progress, children }: { lanes: Lane[]; progress: number; children: ReactNode }) {
  const id = `lanes-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  if (progress <= 0 || lanes.length === 0) return <>{children}</>

  const laneRects = lanes.map((lane) => (
    <rect key={lane.index} x={lane.left} y={0} width={Math.max(0, lane.right - lane.left)} height={VIEW_H} />
  ))
  return (
    <>
      <defs>
        <mask id={`${id}-context`} maskUnits="userSpaceOnUse" x={0} y={0} width={VIEW_W} height={VIEW_H}>
          <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="white" />
          <g fill="black">{laneRects}</g>
        </mask>
        <clipPath id={`${id}-lanes`}>{laneRects}</clipPath>
      </defs>
      <g mask={`url(#${id}-context)`} opacity={1 - progress * (1 - CONTEXT_OPACITY)}>
        {children}
      </g>
      <g clipPath={`url(#${id}-lanes)`}>{children}</g>
    </>
  )
}

/** Convert a pointer / click event on the chart SVG to viewBox coordinates. */
function toViewBoxPoint(event: MouseEvent<SVGSVGElement>) {
  const rect = event.currentTarget.getBoundingClientRect()
  return {
    x: ((event.clientX - rect.left) / rect.width) * VIEW_W,
    y: ((event.clientY - rect.top) / rect.height) * VIEW_H,
  }
}

type ChartGridProps = {
  topLabels: TopLabel[]
  topLabelY?: number
  leftLabel: string
  rightLabel: string
  bottomLabel: string
  horizontalLines?: boolean
  /** Vertical grid line positions (default COL_X); focus mode moves them with the layout. */
  gridX?: number[]
  /** Pointer position in viewBox coordinates (crosshair charts). */
  onPointerMove?: (point: { x: number; y: number }) => void
  onPointerLeave?: () => void
  /** Click position in viewBox coordinates (used to pin columns for comparison). */
  onChartClick?: (point: { x: number; y: number }) => void
  children: ReactNode
}

/** Grid scaffold: column lines, optional row lines, and the mono axis labels. */
export function ChartGrid({
  topLabels,
  topLabelY = 42,
  leftLabel,
  rightLabel,
  bottomLabel,
  horizontalLines = true,
  gridX = COL_X,
  onPointerMove,
  onPointerLeave,
  onChartClick,
  children,
}: ChartGridProps) {
  const axisMidY = (160 + BASE_Y) / 2

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className={cn("block h-auto w-full font-mono select-none", onPointerMove && "cursor-crosshair")}
      role="img"
      onPointerMove={onPointerMove && ((event) => onPointerMove(toViewBoxPoint(event)))}
      onPointerLeave={onPointerLeave}
      onClick={onChartClick && ((event) => onChartClick(toViewBoxPoint(event)))}
    >
      {/* data-anim-* layers are sequenced by the tab transition (see ChartShowcase) */}
      <g stroke="#F3F3F3" strokeWidth={1} vectorEffect="non-scaling-stroke">
        <g data-anim-grid="v">
          {gridX.map((x, i) => (
            <line key={i} x1={x} x2={x} y1={0} y2={BASE_Y} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
        <g data-anim-grid="h">
          {horizontalLines &&
            H_LINES.map((y) => (
              <line key={y} x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y} y2={y} vectorEffect="non-scaling-stroke" />
            ))}
        </g>
      </g>

      <g data-anim-axis fill={LABEL} fontSize={13} letterSpacing="0.08em" textAnchor="middle">
        {topLabels.map((label) => {
          const emphasis = label.emphasis ?? 1
          return (
            <g key={label.text}>
              <text x={label.x} y={topLabelY} opacity={emphasis} data-avoid={emphasis > 0.5 ? "box" : undefined}>
                {label.text}
              </text>
              {emphasis < 1 && <circle cx={label.x} cy={topLabelY - 4} r={2.5} opacity={1 - emphasis} />}
            </g>
          )
        })}
        <text transform={`translate(38 ${axisMidY}) rotate(-90)`} data-avoid="box">
          {leftLabel}
        </text>
        <text transform={`translate(962 ${axisMidY}) rotate(90)`} data-avoid="box">
          {rightLabel}
        </text>
        <text x={VIEW_W / 2} y={506} fill="#B5B5B5" data-avoid="box">
          {bottomLabel}
        </text>
      </g>

      <g data-anim-marks>{children}</g>
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Pinning — click elements to keep them active for comparison         */
/* ------------------------------------------------------------------ */

/**
 * Ordered list of pinned items; clicking an item toggles it. Focus mode is an
 * explicit opt-in (never automatic) and only exists while 2+ items are pinned —
 * dropping below two pins exits it, so re-pinning never re-focuses on its own.
 */
export function usePinnedSelection<T>() {
  const [pinned, setPinned] = useState<T[]>([])
  const [focusRequested, setFocusRequested] = useState(false)
  const toggle = (item: T) => {
    const next = pinned.includes(item) ? pinned.filter((entry) => entry !== item) : [...pinned, item]
    setPinned(next)
    if (next.length < 2) setFocusRequested(false)
  }
  const clear = () => {
    setPinned([])
    setFocusRequested(false)
  }
  const toggleFocus = () => setFocusRequested((value) => !value)
  const focused = focusRequested && pinned.length >= 2
  return { pinned, toggle, clear, focused, toggleFocus }
}

/**
 * Footer slot provided by ChartCard. Charts own their pin state, so they render
 * their PinStatus into the card footer through this slot (via a portal) instead
 * of overlaying it on the chart, where it collided with the axis labels.
 */
export const ChartFooterSlot = createContext<HTMLElement | null>(null)

type PinStatusProps = {
  count: number
  hovering: boolean
  onClear: () => void
  /** Focus controls — omitted on charts that don't support focus mode. */
  focus?: { active: boolean; onToggle: () => void; total: number }
}

const FOOTER_BADGE =
  "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 font-mono text-[10px] uppercase tracking-[0.1em]"

/**
 * Pin status, rendered in the card footer's action row: a "click to compare"
 * hint (darker while hovering the chart), then the pinned count with Focus
 * (2+ pins) and Clear. While focused it reads "Focused · N of T" so the
 * zoomed state is never mistaken for the whole dataset.
 */
export function PinStatus({ count, hovering, onClear, focus }: PinStatusProps) {
  const slot = useContext(ChartFooterSlot)
  if (!slot) return null

  return createPortal(
    <div className="flex items-center gap-1.5">
      {count === 0 ? (
        <span
          className={cn(
            FOOTER_BADGE,
            "pointer-events-none px-0 transition-colors",
            hovering ? "text-[#6B6B66]" : "text-[#B5B5B0]"
          )}
        >
          Click to pin &amp; compare
        </span>
      ) : (
        <>
          <span className={cn(FOOTER_BADGE, "pl-0 text-[#17211A]")}>
            {focus?.active ? `Focused · ${count} of ${focus.total}` : `${count} pinned`}
          </span>
          {focus && count >= 2 && (
            <button
              type="button"
              onClick={focus.onToggle}
              aria-pressed={focus.active}
              className={cn(FOOTER_BADGE, "bg-[#17211A] text-white transition-colors hover:bg-[#2A352D]")}
            >
              <HugeiconsIcon icon={focus.active ? ZoomOutAreaIcon : ZoomInAreaIcon} size={11} strokeWidth={2} />
              {focus.active ? "Exit focus" : "Focus"}
            </button>
          )}
          <button
            type="button"
            onClick={onClear}
            className={cn(FOOTER_BADGE, "bg-[#F4F4F1] text-[#17211A] transition-colors hover:bg-[#EAEAE5]")}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2.25} />
            Clear
          </button>
        </>
      )}
    </div>,
    slot
  )
}

/* ------------------------------------------------------------------ */
/* Axis crosshair — values read off the axes instead of a tooltip      */
/* ------------------------------------------------------------------ */

export type AxisMarker = {
  key: string
  /** True y of the value in viewBox units. */
  y: number
  /** Text shown in the axis badge. */
  value: string
  /** Which value axis the badge sits on. */
  side: "left" | "right"
  color: string
  textColor?: string
}

/** One hovered or pinned column / sample. */
export type CrosshairColumn = {
  key: string
  /** Snapped x in viewBox units. */
  x: number
  /** Text for the x-axis badge on the top label row. */
  label: string
  /** One horizontal line + axis badge per value at this x. */
  markers: AxisMarker[]
  /** Marker nearest the pointer (hovered column only) — drawn with the large dot. */
  activeKey: string | null
  /** Pinned columns keep every marker solid. */
  pinned: boolean
}

const BADGE_H = 28
const BADGE_GAP = 4
const X_BADGE_Y = 22
const SIDE_BADGE = {
  left: { x: 20, width: 86 },
  right: { x: 938, width: 58 },
} as const
const INACTIVE_OPACITY = 0.4

/** The marker whose true y is closest to the pointer — that one is "active". */
export function nearestMarkerKey(markers: AxisMarker[], pointerY: number) {
  let nearest: AxisMarker | null = null
  for (const marker of markers) {
    if (!nearest || Math.abs(marker.y - pointerY) < Math.abs(nearest.y - pointerY)) nearest = marker
  }
  return nearest?.key ?? null
}

/**
 * Lay out badges along one axis without overlap: push them apart in order,
 * clamp the last one inside the end, then pull the rest back so none overflow.
 */
function spreadIntervals(centers: number[], sizes: number[], min: number, max: number, gap: number) {
  const order = centers.map((center, index) => ({ center, index })).sort((a, b) => a.center - b.center)
  const placed = order.map(({ center, index }) => Math.min(max - sizes[index] / 2, Math.max(min + sizes[index] / 2, center)))
  const spacing = (i: number) => sizes[order[i - 1].index] / 2 + gap + sizes[order[i].index] / 2
  for (let i = 1; i < placed.length; i++) placed[i] = Math.max(placed[i], placed[i - 1] + spacing(i))
  const last = placed.length - 1
  if (last >= 0) placed[last] = Math.min(placed[last], max - sizes[order[last].index] / 2)
  for (let i = last - 1; i >= 0; i--) placed[i] = Math.min(placed[i], placed[i + 1] - spacing(i + 1))
  const result: number[] = new Array(centers.length)
  order.forEach(({ index }, i) => (result[index] = placed[i]))
  return result
}

const MIN_BADGE_H = 16

/**
 * Badge height (and gap) for one value axis: full size while they fit, then
 * shrinking so every badge stays inside the chart instead of being clipped.
 */
function sideBadgeSizing(count: number) {
  const available = VIEW_H - 2 * BADGE_GAP
  if (count * (BADGE_H + BADGE_GAP) <= available) return { height: BADGE_H, gap: BADGE_GAP }
  const gap = 2
  return { height: Math.max(MIN_BADGE_H, available / count - gap), gap }
}

/**
 * Line styles for comparing two or more columns: each column gets its own
 * colour and dash pattern, applied to its vertical line, its horizontal lines,
 * and a ring around its badges. Colours avoid the chart mark palette.
 */
const COMPARE_STYLES = [
  { color: "#F0643A", dash: "8 4" }, // coral · long dash
  { color: "#4F46E5", dash: "2 3" }, // indigo · dotted
  { color: "#0E9F8E", dash: "12 4 2 4" }, // teal · dash-dot
  { color: "#D6409F", dash: "4 4" }, // magenta · even dash
  { color: "#B7791F", dash: "1 5" }, // ochre · sparse dots
  { color: "#475569", dash: "16 6" }, // slate · extra-long dash
]
/** Single-column crosshair keeps the neutral ink line. */
const DEFAULT_LINE = { color: INK, dash: "4 4" }
const DASH_SAMPLE_W = 16 // viewBox units reserved in the x badge for the dash sample

/**
 * Crosshair shared by every chart with value axes. Each column (the hovered one
 * plus any pinned ones) gets a dashed vertical line with a solid badge on the
 * x-axis label row, and a dashed horizontal line + badge on the value axis per
 * marker. Hovered columns fade all but the active marker; pinned columns keep
 * every marker solid. Badges from all columns are spread so none overlap.
 * With two or more columns, each one switches to its own colour + dash style.
 */
export function AxisCrosshair({ columns }: { columns: CrosshairColumn[] }) {
  const comparing = columns.length >= 2
  const lineStyles = new Map(
    columns.map((column, i) => [column.key, comparing ? COMPARE_STYLES[i % COMPARE_STYLES.length] : DEFAULT_LINE])
  )
  const lineStyleOf = (column: CrosshairColumn) => lineStyles.get(column.key) ?? DEFAULT_LINE

  const entries = columns.flatMap((column) =>
    column.markers.map((marker) => ({
      id: `${column.key}:${marker.key}`,
      column,
      marker,
      isActive: marker.key === column.activeKey,
      isSolid: column.pinned || marker.key === column.activeKey,
    }))
  )

  const badgeCenters = new Map<string, number>()
  const badgeHeights = { left: BADGE_H, right: BADGE_H }
  for (const side of ["left", "right"] as const) {
    const sideEntries = entries.filter((entry) => entry.marker.side === side)
    const sizing = sideBadgeSizing(sideEntries.length)
    badgeHeights[side] = sizing.height
    const centers = spreadIntervals(
      sideEntries.map((entry) => entry.marker.y),
      sideEntries.map(() => sizing.height),
      BADGE_GAP,
      VIEW_H - BADGE_GAP,
      sizing.gap
    )
    sideEntries.forEach((entry, i) => badgeCenters.set(entry.id, centers[i]))
  }

  const xBadgeWidths = columns.map((column) => column.label.length * 8 + 28 + (comparing ? DASH_SAMPLE_W + 6 : 0))
  const xBadgeCenters = spreadIntervals(
    columns.map((column) => column.x),
    xBadgeWidths,
    4,
    VIEW_W - 4,
    6
  )
  const xBadgeBottom = X_BADGE_Y + BADGE_H

  // Faded first, then solid, then active — so the most important paints on top.
  const ordered = [...entries].sort(
    (a, b) => Number(a.isSolid) - Number(b.isSolid) || Number(a.isActive) - Number(b.isActive)
  )

  return (
    <g pointerEvents="none">
      {columns.map((column, i) => {
        const line = lineStyleOf(column)
        return (
          <path
            key={`v-${column.key}`}
            d={`M${column.x},${BASE_Y} V${xBadgeBottom + 10} L${xBadgeCenters[i]},${xBadgeBottom}`}
            fill="none"
            stroke={line.color}
            strokeOpacity={comparing ? 0.9 : 0.4}
            strokeWidth={comparing ? 1.5 : 1}
            strokeDasharray={line.dash}
            strokeLinecap={comparing ? "round" : "butt"}
            vectorEffect="non-scaling-stroke"
          />
        )
      })}

      {ordered.map(({ id, column, marker, isActive, isSolid }) => {
        const line = lineStyleOf(column)
        const badge = SIDE_BADGE[marker.side]
        const badgeHeight = badgeHeights[marker.side]
        const badgeFont = badgeHeight >= 24 ? 13 : 11
        const badgeY = badgeCenters.get(id) ?? marker.y
        const badgeEdge = marker.side === "left" ? badge.x + badge.width : badge.x
        const elbowX = marker.side === "left" ? badgeEdge + 10 : badgeEdge - 10
        return (
          <g key={id} opacity={isSolid ? 1 : INACTIVE_OPACITY} style={{ transition: "opacity 150ms ease" }}>
            {/* Horizontal line from the value to its badge (elbows if the badge was nudged) */}
            <path
              d={`M${column.x},${marker.y} H${elbowX} L${badgeEdge},${badgeY}`}
              fill="none"
              stroke={line.color}
              strokeOpacity={comparing ? 0.9 : isSolid ? 0.45 : 0.3}
              strokeWidth={comparing ? 1.5 : 1}
              strokeDasharray={line.dash}
              strokeLinecap={comparing ? "round" : "butt"}
              vectorEffect="non-scaling-stroke"
            />
            <rect
              x={badge.x}
              y={badgeY - badgeHeight / 2}
              width={badge.width}
              height={badgeHeight}
              rx={badgeHeight / 2}
              fill={marker.color}
              stroke={comparing ? line.color : "none"}
              strokeWidth={badgeHeight >= 24 ? 2.5 : 2}
            />
            <text
              x={badge.x + badge.width / 2}
              y={badgeY + badgeFont * 0.38}
              fontSize={badgeFont}
              textAnchor="middle"
              fill={marker.textColor ?? INK}
            >
              {marker.value}
            </text>
            <circle
              cx={column.x}
              cy={marker.y}
              r={isActive ? 7 : isSolid ? 5 : 4}
              fill={isSolid ? marker.color : "#fff"}
              stroke={isSolid ? "#fff" : marker.color}
              strokeWidth={2}
            />
          </g>
        )
      })}

      {columns.map((column, i) => {
        const line = lineStyleOf(column)
        const left = xBadgeCenters[i] - xBadgeWidths[i] / 2
        const textCenter = comparing ? xBadgeCenters[i] + (DASH_SAMPLE_W + 6) / 2 : xBadgeCenters[i]
        return (
          <g key={`x-${column.key}`}>
            <rect
              x={left}
              y={X_BADGE_Y}
              width={xBadgeWidths[i]}
              height={BADGE_H}
              rx={BADGE_H / 2}
              fill={INK}
              stroke={comparing ? line.color : "none"}
              strokeWidth={2.5}
            />
            {/* Dash sample so each x badge shows which line style belongs to it */}
            {comparing && (
              <line
                x1={left + 12}
                x2={left + 12 + DASH_SAMPLE_W}
                y1={X_BADGE_Y + BADGE_H / 2}
                y2={X_BADGE_Y + BADGE_H / 2}
                stroke={line.color}
                strokeWidth={2.5}
                strokeDasharray={line.dash}
                strokeLinecap="round"
              />
            )}
            <text x={textCenter} y={X_BADGE_Y + 19} fontSize={13} letterSpacing="0.08em" textAnchor="middle" fill="#fff">
              {column.label}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/* ------------------------------------------------------------------ */
/* Tooltip (for charts without value axes)                             */
/* ------------------------------------------------------------------ */

export type TooltipRow = { label: string; value: string; color?: string }

/** Rectangle in viewBox coordinates. */
export type ViewBoxRect = { x: number; y: number; width: number; height: number }

/** Rectangle in pixels, relative to the chart container. */
type Box = { left: number; top: number; right: number; bottom: number }

const TOOLTIP_GAP = 12 // px kept between the tooltip and the anchored elements
const CONTAINER_EDGE = 8 // px kept from the chart container edges
const SCAN_STEP = 8 // px between candidate positions
const OBSTACLE_PAD = 4 // px of breathing room around every chart mark
const STROKE_SAMPLE = 6 // viewBox units between samples along a line

function overlapArea(a: Box, b: Box) {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return width > 0 && height > 0 ? width * height : 0
}

function distanceBetween(a: Box, b: Box) {
  const dx = Math.max(0, b.left - a.right, a.left - b.right)
  const dy = Math.max(0, b.top - a.bottom, a.top - b.bottom)
  return Math.hypot(dx, dy)
}

function padBox(box: Box, pad: number): Box {
  return { left: box.left - pad, top: box.top - pad, right: box.right + pad, bottom: box.bottom + pad }
}

/**
 * Collect every element tagged with `data-avoid` inside the chart container
 * (SVG marks and HTML overlays like the pin chip), excluding the tooltip itself:
 * - `data-avoid="box"` uses the element's bounding box (bars, points, labels…)
 * - `data-avoid="stroke"` samples small boxes along a path, so a line only
 *   blocks the pixels it actually passes through instead of its whole bbox.
 */
function collectObstacles(container: HTMLElement, svg: SVGSVGElement, tooltip: HTMLElement, origin: DOMRect): Box[] {
  const svgRect = svg.getBoundingClientRect()
  const scale = svgRect.width / VIEW_W
  const offsetX = svgRect.left - origin.left
  const offsetY = svgRect.top - origin.top
  const obstacles: Box[] = []

  container.querySelectorAll<HTMLElement | SVGGraphicsElement>("[data-avoid]").forEach((element) => {
    if (tooltip.contains(element)) return
    if (element.dataset.avoid === "stroke" && element instanceof SVGPathElement) {
      const length = element.getTotalLength()
      for (let distance = 0; distance <= length; distance += STROKE_SAMPLE) {
        const point = element.getPointAtLength(distance)
        const x = offsetX + point.x * scale
        const y = offsetY + point.y * scale
        obstacles.push(padBox({ left: x, top: y, right: x, bottom: y }, OBSTACLE_PAD))
      }
      return
    }
    const rect = element.getBoundingClientRect()
    obstacles.push(
      padBox(
        {
          left: rect.left - origin.left,
          top: rect.top - origin.top,
          right: rect.right - origin.left,
          bottom: rect.bottom - origin.top,
        },
        OBSTACLE_PAD
      )
    )
  })
  return obstacles
}

/**
 * Pick the tooltip position with the lowest cost:
 * - never overlapping any anchored element (hard rule),
 * - cost = distance to the nearest anchor + heavy penalty per px² of overlap with any chart mark.
 * Positions hugging each side of every anchor are tried first, then a grid scan
 * of the whole container finds free space when the sides are crowded.
 */
function placeTooltip(
  container: { width: number; height: number },
  size: { width: number; height: number },
  anchors: Box[],
  obstacles: Box[]
) {
  const minX = CONTAINER_EDGE
  const minY = CONTAINER_EDGE
  const maxX = Math.max(minX, container.width - size.width - CONTAINER_EDGE)
  const maxY = Math.max(minY, container.height - size.height - CONTAINER_EDGE)
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

  const candidates: [number, number][] = anchors.flatMap((anchor): [number, number][] => {
    const centerX = (anchor.left + anchor.right) / 2
    const centerY = (anchor.top + anchor.bottom) / 2
    return [
      [centerX - size.width / 2, anchor.top - TOOLTIP_GAP - size.height], // above
      [anchor.right + TOOLTIP_GAP, centerY - size.height / 2], // right
      [anchor.left - TOOLTIP_GAP - size.width, centerY - size.height / 2], // left
      [anchor.right + TOOLTIP_GAP, anchor.top], // right, top-aligned
      [anchor.left - TOOLTIP_GAP - size.width, anchor.top], // left, top-aligned
      [centerX - size.width / 2, anchor.bottom + TOOLTIP_GAP], // below
    ]
  })
  for (let y = minY; y <= maxY; y += SCAN_STEP) {
    for (let x = minX; x <= maxX; x += SCAN_STEP) candidates.push([x, y])
  }

  const blockedAnchors = anchors.map((anchor) => padBox(anchor, TOOLTIP_GAP - 2))
  let best: { x: number; y: number } | null = null
  let bestCost = Infinity

  for (const [rawX, rawY] of candidates) {
    const x = clamp(rawX, minX, maxX)
    const y = clamp(rawY, minY, maxY)
    const box = { left: x, top: y, right: x + size.width, bottom: y + size.height }
    if (blockedAnchors.some((anchor) => overlapArea(box, anchor) > 0)) continue

    let cost = Math.min(...anchors.map((anchor) => distanceBetween(box, anchor)))
    if (cost >= bestCost) continue
    for (const obstacle of obstacles) {
      cost += overlapArea(box, obstacle) * 50
      if (cost >= bestCost) break
    }
    if (cost < bestCost) {
      bestCost = cost
      best = { x, y }
    }
  }

  return best ?? { x: minX, y: minY }
}

type ChartTooltipProps = {
  /** Bounding boxes of the hovered / pinned elements, in viewBox coordinates. */
  anchors: ViewBoxRect[]
  title: string
  rows: TooltipRow[]
}

/**
 * HTML tooltip rendered next to the chart SVG (both inside the card's relative
 * chart wrapper). It measures itself and the chart marks, then settles in the
 * nearest free space so it never covers the anchored elements or other marks.
 * Positioning runs in a layout effect, so the first paint is already placed.
 */
export function ChartTooltip({ anchors, title, rows }: ChartTooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const anchorsKey = anchors.map((a) => `${a.x},${a.y},${a.width},${a.height}`).join("|")

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current
    const container = tooltip?.parentElement
    const svg = container?.querySelector("svg")
    if (!tooltip || !container || !svg) return

    const origin = container.getBoundingClientRect()
    const svgRect = svg.getBoundingClientRect()
    const scale = svgRect.width / VIEW_W
    const offsetX = svgRect.left - origin.left
    const offsetY = svgRect.top - origin.top
    const anchorBoxes: Box[] = anchors.map((anchor) => ({
      left: offsetX + anchor.x * scale,
      top: offsetY + anchor.y * scale,
      right: offsetX + (anchor.x + anchor.width) * scale,
      bottom: offsetY + (anchor.y + anchor.height) * scale,
    }))

    setPosition(
      placeTooltip(
        { width: origin.width, height: origin.height },
        { width: tooltip.offsetWidth, height: tooltip.offsetHeight },
        anchorBoxes,
        collectObstacles(container, svg, tooltip, origin)
      )
    )
    // anchorsKey captures every anchor coordinate.
  }, [anchorsKey, title, rows.length])

  return (
    <div
      ref={tooltipRef}
      role="tooltip"
      className="pointer-events-none absolute z-20 w-max min-w-[200px] rounded-xl bg-white/95 px-3.5 py-3 shadow-[0_12px_32px_-10px_rgba(23,33,26,0.3)] ring-1 ring-black/5 backdrop-blur-sm"
      style={position ? { left: position.x, top: position.y } : { left: 0, top: 0, visibility: "hidden" }}
    >
      <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[#A3A3A3]">{title}</p>
      <dl className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-6">
            <dt className="flex items-center gap-2 font-display text-[13px] text-[#6B6B6B]">
              {row.color && <span className="size-2 rounded-full" style={{ backgroundColor: row.color }} />}
              {row.label}
            </dt>
            <dd className="font-mono text-[12px] text-[#17211A] tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
