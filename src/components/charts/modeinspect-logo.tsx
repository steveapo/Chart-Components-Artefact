import { cn } from "@/lib/utils"

/** Brand lockup shown in the card footer: the stroked lowercase "acme" wordmark. */
export function ModeinspectLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="25 55 375 120"
      className={cn("h-[22px] w-auto", className)}
      role="img"
      aria-label="acme"
    >
      {/* Letters are nudged left by 5 units each (c −5, m −10, e −15) for tighter spacing */}
      <g fill="none" stroke="#2a2f2b" strokeWidth={9} strokeLinejoin="miter" strokeMiterlimit={10}>
        {/* a */}
        <circle cx="82" cy="114" r="32" />
        <path d="M114 78V150" />
        {/* c */}
        <g transform="translate(-5 0)">
          <path d="M194.5 93.4A32 32 0 1 0 194.5 134.6" />
        </g>
        {/* m */}
        <g transform="translate(-10 0)">
          <path d="M222 78V150" />
          <path d="M222 110A20 28 0 0 1 262 110V150" />
          <path d="M262 110A20 28 0 0 1 302 110V150" />
        </g>
        {/* e */}
        <g transform="translate(-15 0)">
          <path d="M390 114A32 32 0 1 0 382.5 134.6" />
          <path d="M326 114H394.5" />
        </g>
      </g>
    </svg>
  )
}
