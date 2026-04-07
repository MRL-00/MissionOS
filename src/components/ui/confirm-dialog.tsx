import * as React from "react"
import { AlertTriangleIcon, InfoIcon, Trash2Icon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ConfirmVariant = "danger" | "warning" | "info"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: ConfirmVariant
  loading?: boolean
  onConfirm: () => void | Promise<void>
}

const variantConfig: Record<
  ConfirmVariant,
  {
    icon: React.ElementType
    iconClass: string
    ringClass: string
    buttonClass: string
  }
> = {
  danger: {
    icon: Trash2Icon,
    iconClass: "text-red-400",
    ringClass: "ring-red-500/20 bg-red-500/10",
    buttonClass:
      "bg-red-500/15 text-red-400 border-red-500/20 hover:bg-red-500/25 hover:border-red-500/40",
  },
  warning: {
    icon: AlertTriangleIcon,
    iconClass: "text-amber-400",
    ringClass: "ring-amber-500/20 bg-amber-500/10",
    buttonClass:
      "bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/25 hover:border-amber-500/40",
  },
  info: {
    icon: InfoIcon,
    iconClass: "text-blue-400",
    ringClass: "ring-blue-500/20 bg-blue-500/10",
    buttonClass:
      "bg-blue-500/15 text-blue-400 border-blue-500/20 hover:bg-blue-500/25 hover:border-blue-500/40",
  },
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [isLoading, setIsLoading] = React.useState(false)
  const config = variantConfig[variant]
  const Icon = config.icon

  const busy = loading || isLoading

  async function handleConfirm() {
    setIsLoading(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg ring-1",
                config.ringClass
              )}
            >
              <Icon className={cn("size-4", config.iconClass)} />
            </div>
            <div className="flex flex-col gap-1 pt-0.5">
              <DialogTitle>{title}</DialogTitle>
              {description && (
                <DialogDescription>{description}</DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            className={cn(
              "border transition-colors",
              config.buttonClass,
              busy && "opacity-60"
            )}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy && (
              <svg
                className="size-3.5 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            )}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ConfirmDialog, type ConfirmDialogProps, type ConfirmVariant }
