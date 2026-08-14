import * as React from "react"
import { createPortal } from "react-dom"
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
 *
 * Hardening (Gallery SaveDialog fix A–F):
 * - Rendered through `createPortal(document.body)`: escapes the gallery
 *   sidebar island (DOM containment + stacking context). Without this,
 *   Excalidraw's `useOutsideClick` treats backdrop clicks as "inside the
 *   sidebar" only by DOM ancestry — and conversely a portaled overlay that
 *   lacked a guard would be "outside" and collapse the panel on every click.
 * - `data-prevent-outside-click` on the backdrop: Excalidraw's
 *   `useOutsideClick` explicitly skips targets matching this attribute, so a
 *   click on the overlay (backdrop or card) never collapses the gallery panel.
 * - Escape handling: while open, the modal owns the Escape key — dismisses
 *   itself and stops the event from reaching document-level sidebar Escape
 *   listeners. (Excalidraw's window-capture Escape handler may still consume
 *   the key first; the gallery resets its transient state on panel close, so
 *   that path is safe too.)
 * - `z-[2000]`: above Excalidraw's own modal/popup layers (--zIndex-modal:
 *   1000, --zIndex-popup: 1001) so the portaled overlay is always on top.
 */
export function Modal({ open, title, children, onDismiss, className }: ModalProps) {
  const onDismissRef = React.useRef(onDismiss)
  onDismissRef.current = onDismiss

  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopImmediatePropagation()
      event.preventDefault()
      onDismissRef.current?.()
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-prevent-outside-click="true"
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 backdrop-blur-sm transition-all"
      onClick={onDismiss}
    >
      <div
        className={cn(
          "bg-card rounded-lg p-6 w-full max-w-md mx-4 border border-border shadow-xl animate-in fade-in zoom-in-95 duration-200",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-foreground mb-2">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  )
}
