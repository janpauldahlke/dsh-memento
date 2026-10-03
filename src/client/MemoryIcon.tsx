/**
 * The Memory pane's glyph (M4): an open book — memory you can read and edit.
 * Drawn on `currentColor` so the chip and the pane header pick their own ink.
 * Inline SVG only: no CSS pipeline, no icon-font, no image.
 */
import type { CSSProperties, ReactNode } from 'react'

export interface MemoryIconProps {
  /** Square edge in px (default 16, matching the chip's icon slot). */
  size?: number
  /** Extra class for layout placement. */
  className?: string
  style?: CSSProperties
}

export function MemoryIcon({ size = 16, className, style }: MemoryIconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
      style={style}
    >
      {/* left page */}
      <path
        d="M7.5 3.1C6.2 2.4 4.5 2.2 3 2.5V12.5C4.5 12.2 6.2 12.4 7.5 13.1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* right page */}
      <path
        d="M8.5 3.1C9.8 2.4 11.5 2.2 13 2.5V12.5C11.5 12.2 9.8 12.4 8.5 13.1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* spine */}
      <path d="M8 2.8V13.4" stroke="currentColor" strokeLinecap="round" />
      {/* bookmark on the right page */}
      <path d="M11 4.2V8.4L10 7.8L9 8.4V4.2Z" fill="currentColor" />
    </svg>
  )
}
