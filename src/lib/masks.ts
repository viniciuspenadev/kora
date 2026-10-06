// Máscaras BR pra inputs estruturados (proposta, ficha de contato, cadastro).
// Todas idempotentes: recebem o valor cru e devolvem formatado; guarde os dígitos no banco.

/** CPF (000.000.000-00) até 11 dígitos, CNPJ (00.000.000/0000-00) de 12 a 14. */
export function maskCpfCnpj(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 14)
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2")
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2")
}

/** CEP (00000-000). */
export function maskCep(v: string): string {
  return v.replace(/\D/g, "").slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2")
}

/** Telefone BR: (00) 0000-0000 ou (00) 00000-0000. */
export function maskPhone(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11)
  if (d.length <= 10) {
    return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2")
  }
  return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2")
}

/**
 * Telefone BR utilizável de verdade: 10 dígitos (fixo) ou 11 (celular, com o 9).
 *
 * 🔑 Existe por causa de uma cobrança que não passou (05/08). O gateway EXIGE telefone do
 *    titular e valida o número; um `11999999999` gravado no cadastro voltou como
 *    *"Celular informado é inválido"* — depois do cartão digitado, e sobre um campo que
 *    não aparecia em tela nenhuma do fluxo.
 * ⚠️ Rejeita DDD inexistente (< 11) e dígito repetido (`11999999999`, `1133333333`):
 *    passam em qualquer checagem de formato e são exatamente os que o gateway recusa.
 *    Melhor a nossa tela dizer isso, no campo certo, antes do cartão.
 */
export function isValidPhoneBR(v: string | null | undefined): boolean {
  const d = (v ?? "").replace(/\D/g, "")
  if (d.length !== 10 && d.length !== 11) return false
  if (Number(d.slice(0, 2)) < 11) return false
  if (d.length === 11 && d[2] !== "9") return false          // celular sempre tem o 9
  return !/^(\d)\1+$/.test(d.slice(2))                       // 999999999, 33333333…
}

/** `true` quando é celular (11 dígitos com o 9) — decide `mobilePhone` × `phone`. */
export function isMobilePhoneBR(v: string | null | undefined): boolean {
  const d = (v ?? "").replace(/\D/g, "")
  return d.length === 11 && d[2] === "9"
}

/** PF/PJ pelo nº de dígitos do documento (11=cpf, 14=cnpj, senão null). */
export function docKind(doc: string | null | undefined): "cpf" | "cnpj" | null {
  const d = (doc ?? "").replace(/\D/g, "")
  return d.length === 11 ? "cpf" : d.length === 14 ? "cnpj" : null
}

/** Valida CPF pelo dígito verificador (não só o formato). Rejeita repetidos (111…). */
export function isValidCpf(cpf: string | null | undefined): boolean {
  const d = (cpf ?? "").replace(/\D/g, "")
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const dv = (len: number) => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i)
    const r = 11 - (sum % 11)
    return r >= 10 ? 0 : r
  }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}

/** Valida CNPJ pelo dígito verificador. Rejeita repetidos (000…). */
export function isValidCnpj(cnpj: string | null | undefined): boolean {
  const d = (cnpj ?? "").replace(/\D/g, "")
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const dv = (len: number) => {
    let pos = len - 7, sum = 0
    for (let i = 0; i < len; i++) {
      sum += Number(d[i]) * pos--
      if (pos < 2) pos = 9
    }
    const r = sum % 11
    return r < 2 ? 0 : 11 - r
  }
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13])
}
