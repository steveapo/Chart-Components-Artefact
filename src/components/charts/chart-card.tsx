"use client"

import { useState, type ReactNode } from "react"
import { DropdownMenu } from "radix-ui"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, ArrowExpand01Icon, ArrowShrink01Icon, Tick02Icon } from "@hugeicons/core-free-icons"

import { ChartFooterSlot } from "./chart-kit"
import { ChartSettings, type ChartSetting, type ChartSettingsValues } from "./chart-settings"
import { ModeinspectLogo } from "./modeinspect-logo"

export type ChartTheme = {
  /** Outer frame colour. */
  frame: string
  /** Slightly deeper tint for the header pills. */
  pill: string
}

export type LegendItem = { label: string; color: string }

/*
 * Tab transitions are driven by GSAP in ChartShowcase. The card only tags its
 * animatable parts with data attributes:
 *   data-anim-frame       coloured parent container (background tween)
 *   data-anim-pill        header pills (background tween)
 *   data-anim-title-pill  dropdown pill (width tween to fit the new title)
 *   data-anim-title       dropdown title text (slides out / in)
 *   data-anim-panel       white panel (height tween between charts)
 *   data-anim-stage       description and action row (fade out / in)
 *   data-anim-badge       legend badges (swap with a staggered pop)
 * Inside the chart, ChartGrid tags its own layers (data-anim-grid / -axis / -marks).
 */

type ChartCardProps = {
  title: string
  description: string
  theme: ChartTheme
  legend: LegendItem[]
  /** Other charts listed in the title dropdown. */
  options: { id: string; title: string }[]
  currentId: string
  onSelect: (id: string) => void
  expanded: boolean
  onToggleExpand: () => void
  settingsSchema: ChartSetting[]
  settingsValues: ChartSettingsValues
  onSettingChange: (key: string, value: boolean | string) => void
  onSettingsReset: () => void
  children: ReactNode
}

export function ChartCard({
  title,
  description,
  theme,
  legend,
  options,
  currentId,
  onSelect,
  expanded,
  onToggleExpand,
  settingsSchema,
  settingsValues,
  onSettingChange,
  onSettingsReset,
  children,
}: ChartCardProps) {
  // Element the charts portal their pin status into (see ChartFooterSlot).
  const [footerSlot, setFooterSlot] = useState<HTMLDivElement | null>(null)

  return (
    <section
      data-anim-frame
      className="rounded-[28px] p-4 shadow-[0_24px_60px_-28px_rgba(23,33,26,0.25)]"
      style={{ backgroundColor: theme.frame }}
    >
      <header className="flex items-center justify-between gap-4">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              data-anim-pill
              data-anim-title-pill
              className="flex h-[42px] items-center gap-3 overflow-hidden rounded-full px-6 font-display text-[20px] font-medium tracking-[-0.01em] whitespace-nowrap text-[#17211A] outline-none transition-[filter] hover:brightness-95 focus-visible:ring-2 focus-visible:ring-[#17211A]/30"
              style={{ backgroundColor: theme.pill }}
            >
              {/* Mask so the title slides in / out of view vertically */}
              <span className="inline-flex overflow-hidden">
                <span data-anim-title className="inline-block">
                  {title}
                </span>
              </span>
              <HugeiconsIcon icon={ArrowDown01Icon} size={20} strokeWidth={2.25} className="shrink-0" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={8}
              className="z-50 min-w-[240px] rounded-2xl bg-white p-1.5 shadow-[0_16px_40px_-12px_rgba(23,33,26,0.28)] ring-1 ring-black/5 animate-in fade-in-0 zoom-in-95"
            >
              {options.map((option) => (
                <DropdownMenu.Item
                  key={option.id}
                  onSelect={() => onSelect(option.id)}
                  className="flex cursor-pointer items-center justify-between gap-4 rounded-xl px-3 py-2 font-display text-[15px] text-[#17211A] outline-none data-[highlighted]:bg-black/5"
                >
                  {option.title}
                  {option.id === currentId && <HugeiconsIcon icon={Tick02Icon} size={16} strokeWidth={2.25} />}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <div className="flex items-center gap-2">
          <ChartSettings
            schema={settingsSchema}
            values={settingsValues}
            onChange={onSettingChange}
            onReset={onSettingsReset}
            pillColor={theme.pill}
            accentColor={theme.frame}
          />
          <button
            type="button"
            onClick={onToggleExpand}
            aria-label={expanded ? "Collapse chart" : "Expand chart"}
            aria-pressed={expanded}
            data-anim-pill
            className="flex h-[42px] w-[58px] items-center justify-center rounded-full text-[#17211A] outline-none transition-[filter] hover:brightness-95 focus-visible:ring-2 focus-visible:ring-[#17211A]/30"
            style={{ backgroundColor: theme.pill }}
          >
            <HugeiconsIcon icon={expanded ? ArrowShrink01Icon : ArrowExpand01Icon} size={18} strokeWidth={2} />
          </button>
        </div>
      </header>

      {/* The white panel persists across tabs; only its content swaps. */}
      <div data-anim-panel className="mt-4 overflow-hidden rounded-[18px] bg-white">
        <p
          data-anim-stage
          className="border-b border-[#F2F2F2] px-10 py-7 font-serif text-[20px] leading-[1.35] tracking-[-0.01em] text-[#707070]"
        >
          {description}
        </p>

        {/* Charts render their pin status into the footer slot below */}
        <ChartFooterSlot.Provider value={footerSlot}>
          <div className="relative">
            {children}
          </div>
        </ChartFooterSlot.Provider>

        <footer className="flex items-center justify-between gap-6 border-t border-[#F2F2F2] px-8 py-4">
          <div className="flex min-w-0 flex-col items-start gap-2">
            <ul className="flex flex-wrap items-center gap-1.5">
              {legend.map((item) => (
                <li
                  key={item.label}
                  data-anim-badge
                  className="inline-flex h-6 items-center gap-1.5 rounded-full bg-[#F6F6F3] px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#8A8A85]"
                >
                  <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                  {item.label}
                </li>
              ))}
            </ul>
            {/* Action row — always present (hint or pin controls), so the footer never changes height */}
            <div ref={setFooterSlot} data-anim-stage className="flex min-h-6 items-center" />
          </div>
          <ModeinspectLogo className="shrink-0" />
        </footer>
      </div>
    </section>
  )
}
