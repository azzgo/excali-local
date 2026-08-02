import * as React from "react"
import { cn } from "@/lib/utils"

interface ModalProps {
  /** When false, renders nothing. */
  open: boolean
  /** Heading rendered in the card header. */
  title: string
  /** Card body — typically the message paragraph + action button row. */
  children: React.ReactNode
  /** Click on the backdrop → invoked when provided (dismiss). */
  onDismiss?: () => void
  className?: string
}

/**
 * Lightweight centered modal: backdrop + card + title, with `children` as the
 * body. Reproduces the agent-bridge confirm / re-activate overlay shape so every
 * future confirm flow (Wayfinder Tickets 011 / 013 / 014 / 015) shares one
 * component instead of copy-pasting the overlay markup.
 *
 * No Radix dependency — the page has no `react-dialog` and these are
 * low-frequency confirm prompts, not app-wide dialogs.
 */
export function Modal({ open, title, children, onDismiss, className }: ModalProps) {
  if (!open) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-all"
      onClick={onDismiss}
    >
      <div
        className={cn(
          "bg-card rounded-lg p-6 w-full max-w-md mx-4 border border-border shadow-xl animate-in fade-in zoom-in-95 duration-200",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-[var(--text-primary-color)] mb-2">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}
