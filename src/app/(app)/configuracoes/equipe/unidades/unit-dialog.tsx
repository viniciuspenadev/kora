"use client"

import { useRef, useState, useTransition } from "react"
import { Loader2, Check, Archive, RotateCcw, Trash2, Building2, Camera } from "lucide-react"
import { Sheet } from "@/components/ui/sheet"
import { FormRow } from "@/components/ui/form-row"
import { DangerConfirm } from "@/components/ui/danger-confirm"
import {
  createUnit, updateUnit, deleteUnit, uploadUnitLogo, removeUnitLogo, type Unit,
} from "@/lib/actions/team"

const COLORS = [
  "#0EA5E9", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#06B6D4", "#84CC16", "#F97316", "#6366F1",
  "#64748B",
]

const INPUT =
  "w-full h-9 px-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
      {children}
    </h3>
  )
}

interface Props {
  unit:       Unit | null
  onClose:    () => void
  onFeedback: (kind: "ok" | "error", text: string) => void
}

export function UnitDialog({ unit, onClose, onFeedback }: Props) {
  const [name, setName]     = useState(unit?.name ?? "")
  const [color, setColor]   = useState(unit?.color ?? COLORS[0])
  const [active, setActive] = useState(unit?.active ?? true)

  // Ficha da empresa
  const [legalName, setLegalName]   = useState(unit?.legal_name ?? "")
  const [taxId, setTaxId]           = useState(unit?.tax_id ?? "")
  const [phone, setPhone]           = useState(unit?.phone ?? "")
  const [email, setEmail]           = useState(unit?.email ?? "")

  // Endereço
  const [zipCode, setZipCode]       = useState(unit?.zip_code ?? "")
  const [street, setStreet]         = useState(unit?.street ?? "")
  const [number, setNumber]         = useState(unit?.number ?? "")
  const [complement, setComplement] = useState(unit?.complement ?? "")
  const [district, setDistrict]     = useState(unit?.district ?? "")
  const [city, setCity]             = useState(unit?.city ?? "")
  const [uf, setUf]                 = useState(unit?.state ?? "")

  const [pending, startTransition] = useTransition()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleSave() {
    setError(null)
    if (!name.trim()) {
      setError("Nome é obrigatório")
      return
    }
    const profile = {
      legal_name: legalName,
      tax_id:     taxId,
      phone,
      email,
      zip_code:   zipCode,
      street,
      number,
      complement,
      district,
      city,
      state:      uf,
    }
    startTransition(async () => {
      const result = unit
        ? await updateUnit(unit.id, { name: name.trim(), color, active, ...profile })
        : await createUnit(name.trim(), color, profile)
      if ("error" in result && result.error) {
        setError(result.error)
        return
      }
      onFeedback("ok", unit ? "Unidade atualizada" : "Unidade criada")
      onClose()
    })
  }

  async function handleDelete() {
    if (!unit) return
    const result = await deleteUnit(unit.id)
    if ("error" in result && result.error) onFeedback("error", result.error)
    else {
      onFeedback("ok", `Unidade "${unit.name}" excluída`)
      onClose()
    }
  }

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={unit ? "Editar unidade" : "Nova unidade"}
        description="Dados da empresa/filial — alimentam o cabeçalho de cotações e pedidos."
        width="md"
        footer={
          <>
            {unit && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={pending}
                className="mr-auto size-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-danger hover:bg-danger-bg transition-colors disabled:opacity-50"
                title="Excluir unidade"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="h-9 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={pending}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {pending && <Loader2 className="size-3.5 animate-spin" />}
              {unit ? "Salvar" : "Criar"}
            </button>
          </>
        }
      >
        <div className="space-y-7">
          {/* ── Identificação ─────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Identificação</SectionTitle>

            <FormRow label="Nome" required hint="Nome curto de exibição (ex: Matriz, Filial Centro).">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Matriz, Filial Centro, Time Sul…"
                maxLength={40}
                autoFocus
                className={INPUT}
              />
            </FormRow>

            <FormRow label="Logo" hint="Aparece nas cotações e documentos da unidade.">
              {unit ? (
                <LogoBlock unit={unit} onFeedback={onFeedback} />
              ) : (
                <p className="text-[11px] text-slate-400">Salve a unidade primeiro pra enviar o logo.</p>
              )}
            </FormRow>

            <FormRow label="Cor">
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="size-8 rounded-lg transition-transform hover:scale-110 inline-flex items-center justify-center"
                    style={{
                      backgroundColor: c,
                      boxShadow: color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : undefined,
                    }}
                    aria-label={`Cor ${c}`}
                  >
                    {color === c && <Check className="size-4 text-white" />}
                  </button>
                ))}
              </div>
            </FormRow>

            {unit && (
              <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <span className={`size-8 rounded-lg grid place-items-center shrink-0 ${active ? "bg-emerald-50 text-emerald-600" : "bg-slate-200 text-slate-500"}`}>
                  {active ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-800">{active ? "Unidade ativa" : "Unidade arquivada"}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Arquivada não aparece nos seletores, mas mantém o histórico dos negócios já etiquetados.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActive((v) => !v)}
                  className={`h-7 px-2.5 text-[11px] font-semibold rounded-lg border transition-colors ${
                    active
                      ? "border-slate-200 text-slate-600 hover:bg-white"
                      : "border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                  }`}
                >
                  {active ? "Arquivar" : "Reativar"}
                </button>
              </div>
            )}
          </section>

          {/* ── Dados da empresa ──────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Dados da empresa</SectionTitle>

            <FormRow label="Razão social">
              <input
                type="text"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="Empresa Exemplo LTDA"
                className={INPUT}
              />
            </FormRow>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormRow label="CNPJ">
                <input
                  type="text"
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  placeholder="00.000.000/0001-00"
                  className={INPUT}
                />
              </FormRow>
              <FormRow label="Telefone">
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(00) 00000-0000"
                  className={INPUT}
                />
              </FormRow>
            </div>

            <FormRow label="E-mail">
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contato@empresa.com.br"
                className={INPUT}
              />
            </FormRow>
          </section>

          {/* ── Endereço ──────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Endereço</SectionTitle>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <FormRow label="CEP" className="col-span-1">
                <input
                  type="text"
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value)}
                  placeholder="00000-000"
                  className={INPUT}
                />
              </FormRow>
              <FormRow label="Cidade" className="col-span-1 sm:col-span-2">
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="São Paulo"
                  className={INPUT}
                />
              </FormRow>
              <FormRow label="UF" className="col-span-1">
                <input
                  type="text"
                  value={uf}
                  onChange={(e) => setUf(e.target.value)}
                  placeholder="SP"
                  maxLength={2}
                  className={INPUT}
                />
              </FormRow>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
              <FormRow label="Rua / Logradouro">
                <input
                  type="text"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  placeholder="Av. Paulista"
                  className={INPUT}
                />
              </FormRow>
              <FormRow label="Número">
                <input
                  type="text"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="1000"
                  className={INPUT}
                />
              </FormRow>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormRow label="Complemento">
                <input
                  type="text"
                  value={complement}
                  onChange={(e) => setComplement(e.target.value)}
                  placeholder="Sala 12, Bloco B"
                  className={INPUT}
                />
              </FormRow>
              <FormRow label="Bairro">
                <input
                  type="text"
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  placeholder="Bela Vista"
                  className={INPUT}
                />
              </FormRow>
            </div>
          </section>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      </Sheet>

      {unit && (
        <DangerConfirm
          open={confirmDelete}
          title={`Excluir "${unit.name}"?`}
          body={
            <>
              Os negócios e membros etiquetados com esta unidade ficam <strong>&quot;Sem unidade&quot;</strong> (o histórico é mantido).
              <br /><br />
              Se a intenção é só parar de usá-la sem perder a etiqueta, prefira <strong>arquivar</strong>.
              {(unit.deal_count > 0 || unit.user_count > 0) && (
                <>
                  <br /><br />
                  {unit.deal_count > 0 && <><strong>{unit.deal_count}</strong> {unit.deal_count === 1 ? "negócio" : "negócios"}</>}
                  {unit.deal_count > 0 && unit.user_count > 0 && " e "}
                  {unit.user_count > 0 && <><strong>{unit.user_count}</strong> {unit.user_count === 1 ? "membro" : "membros"}</>}
                  {" "}perderão a etiqueta.
                </>
              )}
            </>
          }
          confirmLabel="Excluir"
          onConfirm={handleDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}

// ── Logo da unidade ────────────────────────────────────────────
function LogoBlock({ unit, onFeedback }: { unit: Unit; onFeedback: (kind: "ok" | "error", text: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [hasLogo, setHasLogo] = useState(!!unit.logo_path)
  const [version, setVersion] = useState(0)
  const [imgError, setImgError] = useState(false)

  const showImg = hasLogo && !imgError

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.set("file", file)
    startTransition(async () => {
      const res = await uploadUnitLogo(unit.id, fd)
      if (res.error) { onFeedback("error", res.error); return }
      setHasLogo(true); setImgError(false); setVersion((v) => v + 1)
    })
    e.target.value = ""
  }

  function remove() {
    startTransition(async () => {
      const res = await removeUnitLogo(unit.id)
      if (res.error) { onFeedback("error", res.error); return }
      setHasLogo(false)
    })
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        {showImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/unit-logo/${unit.id}?v=${version}`}
            alt="Logo da unidade"
            onError={() => setImgError(true)}
            className="size-16 rounded-xl object-contain bg-slate-50 ring-1 ring-slate-200"
          />
        ) : (
          <div className="size-16 rounded-xl bg-slate-50 ring-1 ring-slate-200 flex items-center justify-center">
            <Building2 className="size-6 text-slate-300" />
          </div>
        )}
        {pending && (
          <div className="absolute inset-0 rounded-xl bg-black/40 flex items-center justify-center">
            <Loader2 className="size-5 text-white animate-spin" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary-700 disabled:opacity-50"
          >
            <Camera className="size-3.5" /> {hasLogo ? "Trocar" : "Enviar logo"}
          </button>
          {hasLogo && (
            <button
              type="button"
              disabled={pending}
              onClick={remove}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            >
              <Trash2 className="size-3.5" /> Remover
            </button>
          )}
        </div>
        <p className="text-[11px] text-slate-400 mt-2">JPG, PNG ou WebP, até 2MB.</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={onFile}
      />
    </div>
  )
}
