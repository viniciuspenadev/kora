"use client"

// Input de moeda BRL com máscara — digita só números, formata como R$ 1.500,00 (centavos).
// value/onChange em NÚMERO (não string): null = vazio. Reutilizável em todo lugar de valor.
export function CurrencyInput({ value, onChange, placeholder = "0,00", className = "", autoFocus, disabled }: {
  value:    number | null
  onChange: (v: number | null) => void
  placeholder?: string
  className?:   string
  autoFocus?:   boolean
  disabled?:    boolean
}) {
  const display = value != null ? value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""
  function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, "")
    onChange(digits ? Number(digits) / 100 : null)
  }
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">R$</span>
      <input
        inputMode="numeric" value={display} onChange={handle} placeholder={placeholder} autoFocus={autoFocus} disabled={disabled}
        className={`w-full h-9 pl-9 pr-3 text-sm border border-slate-200 rounded-lg bg-white tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 disabled:bg-slate-50 ${className}`}
      />
    </div>
  )
}
