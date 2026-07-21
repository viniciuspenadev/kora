"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { ChevronDown, Check } from "lucide-react"
import { cn } from "@/lib/utils"

// ═══════════════════════════════════════════════════════════════
// Select — dropdown ANIMADO do design system (Base UI, igual ao DropdownMenu)
// ═══════════════════════════════════════════════════════════════
// O padrão UNIVERSAL pra "input que desce uma lista": trigger com cara de
// <Input> + lista custom com animação (fade+zoom+slide, mesma do dropdown-menu),
// check no item selecionado, teclado/a11y do Base UI.
//
//   • <SimpleSelect value onChange options placeholder /> — 90% dos casos
//     (drop-in no lugar de <select> cru com <option>).
//   • Compound (Select/SelectTrigger/SelectContent/SelectItem…) — casos ricos
//     (ícones, grupos, conteúdo custom no item).
//   • <NativeSelect> — o <select> nativo estilizado (raro: listas gigantes ou
//     forms mobile-critical onde o picker nativo do SO é melhor).

const Select = SelectPrimitive.Root

function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white pl-3 pr-2.5 text-sm text-slate-800",
        "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-300",
        "data-popup-open:ring-2 data-popup-open:ring-primary/30 data-popup-open:border-primary-300",
        "disabled:opacity-50 disabled:cursor-not-allowed [&>span]:truncate text-left",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronDown className="size-4 shrink-0 text-slate-400 transition-transform duration-200 group-data-popup-open:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

const SelectValue = SelectPrimitive.Value

function SelectContent({ className, children, ...props }: SelectPrimitive.Popup.Props) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        className="isolate z-50 outline-none"
        sideOffset={4}
        alignItemWithTrigger={false}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            // Abertura: desce do trigger com fade + zoom + slide, easing expo-out
            // (rápido no início, assentando suave — a sensação "premium").
            "z-50 max-h-[min(24rem,var(--available-height))] w-(--anchor-width) min-w-32 origin-(--transform-origin)",
            "overflow-x-hidden overflow-y-auto rounded-xl bg-white p-1.5 shadow-xl shadow-slate-900/10 ring-1 ring-slate-900/[0.08] outline-none",
            "duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:duration-100 data-closed:overflow-hidden",
            className,
          )}
          {...props}
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex cursor-pointer items-center gap-1.5 rounded-lg py-2 pr-8 pl-2.5 text-sm text-slate-700 outline-hidden select-none",
        "transition-colors duration-100",
        // Hover/teclado: wash primary (branded) — o item "acende" ao passar.
        "data-highlighted:bg-primary-50 data-highlighted:text-primary-900",
        // Selecionado: fica marcado mesmo sem hover (tinta + peso + check).
        "data-selected:bg-primary-50/60 data-selected:font-semibold data-selected:text-primary-700",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="pointer-events-none absolute right-2.5 flex items-center justify-center">
        <SelectPrimitive.ItemIndicator className="animate-in zoom-in-50 fade-in-0 duration-150">
          <Check className="size-4 text-primary-600" strokeWidth={2.5} />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  )
}

function SelectGroup(props: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400", className)}
      {...props}
    />
  )
}

// ═══ SimpleSelect — o drop-in dos 90% ═══════════════════════════
// Substitui `<select className={INPUT}><option/>…</select>` com 1 componente.

export interface SimpleSelectOption {
  value:     string
  label:     string
  disabled?: boolean
  /** Agrupa opções sob um cabeçalho (equivale ao <optgroup>). */
  group?:    string
}

export function SimpleSelect({
  value, onChange, options, placeholder = "— selecione —", className, disabled,
}: {
  value:        string
  onChange:     (value: string) => void
  options:      SimpleSelectOption[]
  placeholder?: string
  className?:   string
  disabled?:    boolean
}) {
  // "" pode ser OPÇÃO legítima (ex: "— qualquer —"): se existir na lista, o value
  // passa cru; sem opção "" o vazio vira null → placeholder.
  const hasEmptyOption = options.some((o) => o.value === "")
  return (
    <Select
      value={value === "" && !hasEmptyOption ? null : value}
      onValueChange={(v) => onChange((v as string) ?? "")}
      disabled={disabled}
    >
      <SelectTrigger className={cn("group", className)}>
        <SelectValue>
          {(v: unknown) => {
            const found = options.find((o) => o.value === v)
            return found
              ? <span>{found.label}</span>
              : <span className="text-slate-400">{placeholder}</span>
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {(() => {
          // Preserva a ordem: agrupa consecutivos pelo `group` (undefined = solto).
          const blocks: { group?: string; items: SimpleSelectOption[] }[] = []
          for (const o of options) {
            const last = blocks[blocks.length - 1]
            if (last && last.group === o.group) last.items.push(o)
            else blocks.push({ group: o.group, items: [o] })
          }
          return blocks.map((b, i) =>
            b.group ? (
              <SelectGroup key={`g-${b.group}-${i}`}>
                <SelectLabel>{b.group}</SelectLabel>
                {b.items.map((o) => (
                  <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>
                ))}
              </SelectGroup>
            ) : (
              b.items.map((o) => (
                <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>
              ))
            )
          )
        })()}
      </SelectContent>
    </Select>
  )
}

// ═══ NativeSelect — o <select> nativo estilizado (casos raros) ═══
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        className={cn(
          "h-9 w-full appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 text-sm text-slate-800",
          "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary-300",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
    </div>
  )
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel }
