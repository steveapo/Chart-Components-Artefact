"use client"

import { Popover } from "radix-ui"
import { HugeiconsIcon } from "@hugeicons/react"
import { RefreshIcon, SlidersHorizontalIcon } from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"

/* ------------------------------------------------------------------ */
/* Settings model — each chart declares its own schema                 */
/* ------------------------------------------------------------------ */

export type ToggleSetting = {
  kind: "toggle"
  key: string
  label: string
  defaultValue: boolean
}

export type ChoiceSetting = {
  kind: "choice"
  key: string
  label: string
  options: { value: string; label: string }[]
  defaultValue: string
}

export type ChartSetting = ToggleSetting | ChoiceSetting
export type ChartSettingsValues = Record<string, boolean | string>

export function defaultSettings(schema: ChartSetting[]): ChartSettingsValues {
  return Object.fromEntries(schema.map((setting) => [setting.key, setting.defaultValue]))
}

/** Read a toggle value. */
export function isOn(values: ChartSettingsValues, key: string) {
  return values[key] === true
}

/** Read a choice value. */
export function choiceOf(values: ChartSettingsValues, key: string) {
  return String(values[key])
}

/* ------------------------------------------------------------------ */
/* Chart settings popover — the same control in every card header      */
/* ------------------------------------------------------------------ */

type ChartSettingsProps = {
  schema: ChartSetting[]
  values: ChartSettingsValues
  onChange: (key: string, value: boolean | string) => void
  onReset: () => void
  /** Card pill colour, so the trigger matches the frame. */
  pillColor: string
  /** Card frame colour, used as the active switch thumb. */
  accentColor: string
}

export function ChartSettings({ schema, values, onChange, onReset, pillColor, accentColor }: ChartSettingsProps) {
  const isModified = schema.some((setting) => values[setting.key] !== setting.defaultValue)
  const toggles = schema.filter((setting): setting is ToggleSetting => setting.kind === "toggle")
  const choices = schema.filter((setting): setting is ChoiceSetting => setting.kind === "choice")

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Chart settings"
          data-anim-pill
          className="relative flex h-[42px] w-[58px] items-center justify-center rounded-full text-[#17211A] outline-none transition-[filter] hover:brightness-95 focus-visible:ring-2 focus-visible:ring-[#17211A]/30 data-[state=open]:brightness-90"
          style={{ backgroundColor: pillColor }}
        >
          <HugeiconsIcon icon={SlidersHorizontalIcon} size={18} strokeWidth={2} />
          {isModified && (
            <span
              className="absolute top-2 right-3.5 size-2 rounded-full bg-[#17211A]"
              style={{ boxShadow: `0 0 0 2px ${pillColor}` }}
            />
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[300px] rounded-2xl bg-white p-2 shadow-[0_16px_40px_-12px_rgba(23,33,26,0.28)] ring-1 ring-black/5 animate-in fade-in-0 zoom-in-95"
        >
          <div className="flex items-center justify-between px-3 pt-2 pb-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#A3A3A3]">Chart settings</p>
            <button
              type="button"
              onClick={onReset}
              disabled={!isModified}
              className="flex items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-[#17211A] transition-opacity hover:bg-black/5 disabled:pointer-events-none disabled:opacity-30"
            >
              <HugeiconsIcon icon={RefreshIcon} size={12} strokeWidth={2} />
              Reset
            </button>
          </div>

          {toggles.length > 0 && (
            <ul className="border-t border-[#F2F2F2] pt-1.5">
              {toggles.map((setting) => {
                const checked = isOn(values, setting.key)
                return (
                  <li key={setting.key}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={checked}
                      onClick={() => onChange(setting.key, !checked)}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 font-display text-[15px] text-[#17211A] outline-none hover:bg-black/[0.03] focus-visible:bg-black/[0.04]"
                    >
                      {setting.label}
                      <span
                        className={cn(
                          "flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
                          checked ? "bg-[#17211A]" : "bg-[#E6E6E2]"
                        )}
                      >
                        <span
                          className={cn(
                            "size-4 rounded-full shadow-sm transition-transform",
                            checked ? "translate-x-4" : "translate-x-0 bg-white"
                          )}
                          style={checked ? { backgroundColor: accentColor } : undefined}
                        />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {choices.map((setting) => (
            <div key={setting.key} className="mt-1.5 border-t border-[#F2F2F2] px-3 pt-3 pb-2">
              <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[#A3A3A3]">{setting.label}</p>
              <div role="radiogroup" aria-label={setting.label} className="flex rounded-full bg-[#F4F4F1] p-1">
                {setting.options.map((option) => {
                  const selected = choiceOf(values, setting.key) === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => onChange(setting.key, option.value)}
                      className={cn(
                        "flex-1 rounded-full px-2 py-1.5 font-display text-[13px] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#17211A]/20",
                        selected
                          ? "bg-white text-[#17211A] shadow-[0_1px_3px_rgba(23,33,26,0.12)]"
                          : "text-[#8A8A8A] hover:text-[#17211A]"
                      )}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
