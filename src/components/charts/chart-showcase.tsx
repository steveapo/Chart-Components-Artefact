"use client"

import { useRef, useState } from "react"
import { flushSync } from "react-dom"
import { Tabs } from "radix-ui"
import gsap from "gsap"
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin"
import { useGSAP } from "@gsap/react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft02Icon, ArrowRight02Icon } from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"
import { ChartCard } from "./chart-card"
import { defaultSettings, type ChartSettingsValues } from "./chart-settings"
import { charts } from "./charts"

gsap.registerPlugin(useGSAP, DrawSVGPlugin)
// Some layers are legitimately empty (e.g. no horizontal grid on the heatmap).
gsap.config({ nullTargetWarn: false })

const chartOptions = charts.map(({ id, title }) => ({ id, title }))

/** Every chart starts with the defaults declared in its settings schema. */
const initialSettings: Record<string, ChartSettingsValues> = Object.fromEntries(
  charts.map((chart) => [chart.id, defaultSettings(chart.settings)])
)

/** 1 = moving to the next chart, -1 = to the previous one. */
type Direction = 1 | -1

/** Clicking again mid-transition speeds the running one up, then plays the queued one. */
const HURRY = 2.2

/**
 * The chart's animatable layers (tagged in ChartGrid / the charts):
 *   marks  every other drawn shape — bars, points, cells, values — ordered
 *          left → right (or right → left when moving back) so pops ripple across
 *   lines  stroked series lines (data-anim-line) — drawn / undrawn along their path
 *   areas  filled areas under lines (data-anim-area) — fade with their line
 *   axis   axis labels (opacity only: the side labels carry rotate transforms)
 *   gridV / gridH  vertical and horizontal background grid lines
 */
function chartLayers(q: gsap.utils.SelectorFunc, direction: Direction) {
  const centerX = (element: SVGGraphicsElement) => {
    const box = element.getBBox()
    return box.x + box.width / 2
  }
  const outsideDefs = (element: Element) => !element.closest("defs, mask, clipPath")
  const marks = q<SVGGraphicsElement>("[data-anim-marks] :is(path, rect, circle, line, text)")
    .filter((element) => outsideDefs(element) && !element.matches("[data-anim-line], [data-anim-area]"))
    .map((element) => ({ element, x: centerX(element) }))
    .sort((a, b) => (a.x - b.x) * direction)
    .map(({ element }) => element)
  return {
    marks,
    lines: q("[data-anim-marks] [data-anim-line]").filter(outsideDefs),
    areas: q("[data-anim-marks] [data-anim-area]").filter(outsideDefs),
    axis: q("[data-anim-axis] > *"),
    gridV: q('[data-anim-grid="v"] line'),
    gridH: q('[data-anim-grid="h"] line'),
  }
}

/**
 * DrawSVG segments for lines, following the travel direction: moving forward,
 * lines erase from the left and redraw left → right; moving back, the reverse.
 */
function lineSegments(direction: Direction) {
  return direction === 1
    ? { hidden: "0% 0%", erased: "100% 100%" }
    : { hidden: "100% 100%", erased: "0% 0%" }
}

export function ChartShowcase() {
  // `target` is the selected chart (nav dots, dropdown tick); `displayed` is the
  // chart the card renders — it only swaps midway through the GSAP transition.
  const [target, setTarget] = useState(0)
  const [displayed, setDisplayed] = useState(0)
  const [expanded, setExpanded] = useState(false)
  // Settings are kept per chart so they persist while switching tabs.
  const [settingsById, setSettingsById] = useState(initialSettings)

  const scopeRef = useRef<HTMLDivElement>(null)
  const displayedRef = useRef(0)
  const runningRef = useRef<gsap.core.Timeline | null>(null)
  const queuedRef = useRef<{ index: number; direction: Direction } | null>(null)
  const { contextSafe } = useGSAP({ scope: scopeRef })

  /** When a transition ends, play the latest queued selection (if any). */
  const finish = () => {
    runningRef.current = null
    const queued = queuedRef.current
    queuedRef.current = null
    if (queued && queued.index !== displayedRef.current) transition(queued.index, queued.direction)
  }

  /**
   * Swap the card to the next chart, then run steps 2 and 3:
   * the frame / pill colours, dropdown title and legend badges change, and the new chart comes in.
   */
  const swapAndEnter = contextSafe((next: number, direction: Direction, timeScale: number) => {
    const q = gsap.utils.selector(scopeRef)
    const from = charts[displayedRef.current]
    const to = charts[next]
    const panel = q("[data-anim-panel]")[0] as HTMLElement
    const titlePill = q("[data-anim-title-pill]")[0] as HTMLElement

    // Measure → swap (synchronously) → measure, so sizes can tween between charts.
    const panelFrom = panel.offsetHeight
    const pillFrom = titlePill.offsetWidth
    flushSync(() => setDisplayed(next))
    displayedRef.current = next
    const panelTo = panel.offsetHeight
    const pillTo = titlePill.offsetWidth

    const enter = gsap.timeline({ defaults: { ease: "power3.out" }, onComplete: finish })
    enter.timeScale(timeScale)
    runningRef.current = enter

    // 2 — Parent colour, dropdown name and badges change
    enter
      .fromTo(
        q("[data-anim-frame]"),
        { backgroundColor: from.theme.frame },
        { backgroundColor: to.theme.frame, duration: 0.7, ease: "power2.inOut" },
        0
      )
      .fromTo(
        q("[data-anim-pill]"),
        { backgroundColor: from.theme.pill },
        { backgroundColor: to.theme.pill, duration: 0.7, ease: "power2.inOut", stagger: 0.04 },
        0
      )
      .fromTo(
        titlePill,
        { width: pillFrom },
        { width: pillTo, duration: 0.55, ease: "power3.inOut", clearProps: "width" },
        0
      )
      .fromTo(
        q("[data-anim-title]"),
        { yPercent: 110 * direction, autoAlpha: 0, filter: "blur(4px)" },
        { yPercent: 0, autoAlpha: 1, filter: "blur(0px)", duration: 0.55, clearProps: "all" },
        0.15
      )
      .fromTo(
        q("[data-anim-badge]"),
        { autoAlpha: 0, y: 8, scale: 0.8 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: "back.out(1.8)", stagger: 0.06, clearProps: "all" },
        0.2
      )
      .fromTo(
        panel,
        { height: panelFrom },
        { height: panelTo, duration: 0.6, ease: "power3.inOut", clearProps: "height" },
        0
      )

    // 3 — The new chart comes in, in reverse order: grid draws, axis appears, elements pop in
    const layers = chartLayers(q, direction)
    enter
      .fromTo(
        layers.gridV,
        { scaleY: 0, transformOrigin: "50% 100%" },
        {
          scaleY: 1,
          duration: 0.55,
          stagger: { amount: 0.2, from: direction === 1 ? "start" : "end" },
          clearProps: "transform",
        },
        0.25
      )
      .fromTo(
        layers.gridH,
        { scaleX: 0, transformOrigin: "50% 50%" },
        { scaleX: 1, duration: 0.55, stagger: { amount: 0.12, from: "end" }, clearProps: "transform" },
        0.3
      )
      .fromTo(
        layers.axis,
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.35, ease: "power2.out", stagger: { amount: 0.15 }, clearProps: "opacity,visibility" },
        0.55
      )
      .fromTo(
        layers.marks,
        { scale: 0, transformOrigin: "50% 50%" },
        { scale: 1, duration: 0.5, ease: "back.out(1.7)", stagger: { amount: 0.35 }, clearProps: "transform" },
        0.75
      )
      // Lines draw along their path in the travel direction (points pop onto them); areas fade in beneath
      .fromTo(
        layers.lines,
        { drawSVG: lineSegments(direction).hidden },
        {
          drawSVG: "0% 100%",
          duration: 0.9,
          ease: "power2.inOut",
          stagger: 0.12,
          clearProps: "strokeDasharray,strokeDashoffset",
        },
        0.7
      )
      .fromTo(
        layers.areas,
        { opacity: 0 },
        { opacity: 1, duration: 0.7, ease: "power2.out", stagger: 0.08, clearProps: "opacity" },
        0.9
      )
      // Description settles in early; the action row arrives with the elements
      .fromTo(
        q("[data-anim-stage]"),
        { autoAlpha: 0, y: 8, filter: "blur(4px)" },
        {
          autoAlpha: 1,
          y: 0,
          filter: "blur(0px)",
          duration: 0.5,
          stagger: 0.6,
          clearProps: "opacity,visibility,transform,filter",
        },
        0.35
      )
  })

  /** 1 — The current chart goes out, then hand over to swapAndEnter. */
  const transition = contextSafe((next: number, direction: Direction) => {
    if (next === displayedRef.current) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      displayedRef.current = next
      setDisplayed(next)
      return
    }

    const q = gsap.utils.selector(scopeRef)
    const leave = gsap.timeline({
      onComplete: () => {
        // A selection made while leaving wins — skip straight to it instead of stopping in between.
        const queued = queuedRef.current
        queuedRef.current = null
        if (queued) swapAndEnter(queued.index, queued.direction, leave.timeScale())
        else swapAndEnter(next, direction, leave.timeScale())
      },
    })
    runningRef.current = leave

    const layers = chartLayers(q, direction)
    leave
      // Description and action row fade out gently while the chart takes itself apart
      .to(
        q("[data-anim-stage]"),
        { autoAlpha: 0, y: -6, filter: "blur(4px)", duration: 0.3, ease: "power2.in", stagger: 0.08 },
        0
      )
      // 1a — Chart elements pop out (scale down), rippling across the chart
      .to(
        layers.marks,
        { scale: 0, transformOrigin: "50% 50%", duration: 0.32, ease: "back.in(1.7)", stagger: { amount: 0.22 } },
        0
      )
      // Lines undraw along their path instead of scaling; areas fade out with them
      .to(
        layers.lines,
        { drawSVG: lineSegments(direction).erased, duration: 0.45, ease: "power2.in", stagger: 0.06 },
        0
      )
      .to(layers.areas, { opacity: 0, duration: 0.35, ease: "power2.in", stagger: 0.05 }, 0.05)
      // 1b — Then the axis labels fade away
      .to(layers.axis, { autoAlpha: 0, duration: 0.24, ease: "power2.in", stagger: { amount: 0.12 } }, 0.38)
      // 1c — Then the background grid undraws: columns retract into the baseline, rows collapse to centre
      .to(
        layers.gridV,
        {
          scaleY: 0,
          transformOrigin: "50% 100%",
          duration: 0.34,
          ease: "power3.in",
          stagger: { amount: 0.14, from: direction === 1 ? "start" : "end" },
        },
        0.5
      )
      .to(
        layers.gridH,
        { scaleX: 0, transformOrigin: "50% 50%", duration: 0.34, ease: "power3.in", stagger: { amount: 0.1 } },
        0.5
      )
      // Title and badges leave just before the swap (they change in step 2)
      .to(
        q("[data-anim-title]"),
        { yPercent: -110 * direction, autoAlpha: 0, filter: "blur(4px)", duration: 0.26, ease: "power2.in" },
        0.6
      )
      .to(
        q("[data-anim-badge]"),
        {
          autoAlpha: 0,
          y: -6,
          scale: 0.85,
          duration: 0.22,
          ease: "power2.in",
          stagger: { each: 0.035, from: direction === 1 ? "start" : "end" },
        },
        "<"
      )
  })

  const navigate = (next: number, direction: Direction) => {
    if (next === target) return
    setTarget(next)
    if (runningRef.current) {
      queuedRef.current = { index: next, direction }
      runningRef.current.timeScale(HURRY)
      return
    }
    transition(next, direction)
  }

  const updateSetting = (chartId: string, key: string, value: boolean | string) =>
    setSettingsById((previous) => ({ ...previous, [chartId]: { ...previous[chartId], [key]: value } }))
  const resetSettings = (chartId: string) =>
    setSettingsById((previous) => ({ ...previous, [chartId]: initialSettings[chartId] }))

  const selectById = (id: string) => {
    const index = charts.findIndex((chart) => chart.id === id)
    if (index !== -1) navigate(index, index > target ? 1 : -1)
  }
  // Arrows wrap around at either end.
  const goPrevious = () => navigate((target - 1 + charts.length) % charts.length, -1)
  const goNext = () => navigate((target + 1) % charts.length, 1)

  const selected = charts[target]
  const shown = charts[displayed]
  const ShownChart = shown.Chart

  return (
    <Tabs.Root
      value={selected.id}
      onValueChange={selectById}
      className="flex min-h-screen w-full flex-col items-center justify-center gap-8 bg-[#F4F4F1] px-6 py-10"
    >
      {/* One persistent card — GSAP morphs it between charts instead of replacing it */}
      <Tabs.Content
        ref={scopeRef}
        value={selected.id}
        className={cn(
          "w-full outline-none transition-[max-width] duration-300",
          expanded ? "max-w-[1240px]" : "max-w-[880px]"
        )}
      >
        <ChartCard
          title={shown.title}
          description={shown.description}
          theme={shown.theme}
          legend={shown.legend}
          options={chartOptions}
          currentId={selected.id}
          onSelect={selectById}
          expanded={expanded}
          onToggleExpand={() => setExpanded((value) => !value)}
          settingsSchema={shown.settings}
          settingsValues={settingsById[shown.id]}
          onSettingChange={(key, value) => updateSetting(shown.id, key, value)}
          onSettingsReset={() => resetSettings(shown.id)}
        >
          <ShownChart key={shown.id} settings={settingsById[shown.id]} />
        </ChartCard>
      </Tabs.Content>

      <nav aria-label="Chart navigation" className="flex flex-col items-center gap-4">
        <Tabs.List aria-label="Charts" className="flex items-center gap-1.5">
          {charts.map(({ id, title }) => (
            <Tabs.Trigger
              key={id}
              value={id}
              aria-label={title}
              className="h-1.5 w-1.5 rounded-full bg-[#17211A]/15 outline-none transition-all duration-[420ms] ease-[var(--morph-ease)] hover:bg-[#17211A]/30 focus-visible:ring-2 focus-visible:ring-[#17211A]/30 focus-visible:ring-offset-2 data-[state=active]:w-6 data-[state=active]:bg-[#17211A]"
            />
          ))}
        </Tabs.List>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goPrevious}
            aria-label="Previous chart"
            className="flex size-10 items-center justify-center rounded-full bg-white text-[#17211A] shadow-[0_4px_14px_-6px_rgba(23,33,26,0.25)] ring-1 ring-black/5 transition-colors hover:bg-[#FAFAF8] focus-visible:ring-2 focus-visible:ring-[#17211A]/30 outline-none"
          >
            <HugeiconsIcon icon={ArrowLeft02Icon} size={18} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={goNext}
            aria-label="Next chart"
            className="flex size-10 items-center justify-center rounded-full bg-white text-[#17211A] shadow-[0_4px_14px_-6px_rgba(23,33,26,0.25)] ring-1 ring-black/5 transition-colors hover:bg-[#FAFAF8] focus-visible:ring-2 focus-visible:ring-[#17211A]/30 outline-none"
          >
            <HugeiconsIcon icon={ArrowRight02Icon} size={18} strokeWidth={2} />
          </button>
        </div>
      </nav>
    </Tabs.Root>
  )
}
