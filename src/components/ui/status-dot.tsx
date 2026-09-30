import { cn } from "@/lib/utils"

type Tone = "success" | "warning" | "danger" | "info" | "neutral"

const TONE: Record<Tone, { dot: string; ring: string; text: string }> = {
  success: { dot: "bg-emerald-500",  ring: "ring-emerald-500/30", text: "text-emerald-700" },
  warning: { dot: "bg-amber-500",    ring: "ring-amber-500/30",   text: "text-amber-700" },
  danger:  { dot: "bg-red-500",      ring: "ring-red-500/30",     text: "text-red-700" },
  info:    { dot: "bg-primary",      ring: "ring-primary/30",     text: "text-primary-700" },
  neutral: { dot: "bg-slate-400",    ring: "ring-slate-400/20",   text: "text-slate-600" },
}

interface Props {
  tone:    Tone
  label?:  string
  pulse?:  boolean
  size?:   "sm" | "md"
  className?: string
}

export function StatusDot({ tone, label, pulse, size = "md", className }: Props) {
  const t = TONE[tone]
  const dotSize = size === "sm" ? "size-1.5" : "size-2"

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="relative inline-flex">
        <span className={cn(dotSize, "rounded-full ring-4", t.dot, t.ring)} />
        {pulse && (
          <span className={cn(dotSize, "absolute inset-0 rounded-full animate-ping opacity-60", t.dot)} />
        )}
      </span>
      {label && (
        <span className={cn("text-xs font-medium", t.text)}>{label}</span>
      )}
    </span>
  )
}
