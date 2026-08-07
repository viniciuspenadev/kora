"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { logAudit } from "@/lib/audit"
import { rateLimit } from "@/lib/rate-limit"
import { opcaoValida } from "@/lib/onboarding-options"

// ═══════════════════════════════════════════════════════════════
// Wizard de boas-vindas — origem + perfil do negócio
// ═══════════════════════════════════════════════════════════════
// A parte FISCAL do wizard (empresa + endereço) NÃO passa por aqui: ela reusa
// `saveMyCompanyProfile` (lib/actions/company-profile.ts), que já tem a allow-list, a
// checagem de documento duplicado e o espelho no Asaas. Duplicar aquilo aqui criaria uma
// segunda porta de escrita no cadastro fiscal — com outras regras.
//
// ⚠️ `"use server"`: toda exportação é action pública. As três se gateiam sozinhas e
//    nenhuma recebe `tenantId` por parâmetro.

export interface RespostasWizard {
  acquisition_source?: string | null
  acquisition_detail?: string | null
  business_segment?:   string | null
  team_size?:          string | null
  current_tool?:       string | null
}

/** Teto do único campo livre do wizard. Curto de propósito — é um complemento, não um texto. */
const TETO_DETALHE = 120

async function sessaoDeDono() {
  const session = await auth()
  if (!session?.user?.tenantId) return null
  // Cadastro da conta é assunto de quem responde pela empresa. Um atendente não deve
  // declarar segmento nem origem do cliente — nem ser interrompido por um wizard que
  // não é dele.
  if (!["owner", "admin"].includes(session.user.role)) return null
  return session
}

/**
 * Grava as respostas de pesquisa do wizard.
 *
 * ⚠️ Nunca recusa por valor inválido — `opcaoValida` descarta em silêncio. Isto é
 *    pesquisa; travar a entrada da pessoa no produto por causa de um campo de marketing
 *    seria trocar o problema certo pelo errado.
 */
export async function saveOnboardingSurvey(input: RespostasWizard): Promise<{ error?: string; ok?: boolean }> {
  const session = await sessaoDeDono()
  if (!session) return { error: "Você não tem permissão para isso." }
  const tenantId = session.user.tenantId

  if (!rateLimit(`onboarding:survey:${tenantId}`, 40, 60 * 60_000).ok) {
    return { error: "Muitas alterações seguidas. Tente de novo em alguns minutos." }
  }

  const origem = opcaoValida("acquisition_source", input.acquisition_source)

  const { error } = await supabaseAdmin
    .from("tenants")
    .update({
      acquisition_source: origem,
      // O complemento só faz sentido colado numa origem. Sem origem escolhida ele vira
      // texto órfão que ninguém consegue ler depois.
      acquisition_detail: origem ? ((input.acquisition_detail ?? "").trim().slice(0, TETO_DETALHE) || null) : null,
      business_segment:   opcaoValida("business_segment", input.business_segment),
      team_size:          opcaoValida("team_size",        input.team_size),
      current_tool:       opcaoValida("current_tool",     input.current_tool),
      updated_at:         new Date().toISOString(),
    })
    .eq("id", tenantId)

  if (error) return { error: "Não foi possível salvar. Tente novamente." }
  return { ok: true }
}

/** Marca o wizard como concluído. É o que tira o passo do checklist de setup. */
export async function finishOnboarding(): Promise<{ error?: string; ok?: boolean }> {
  const session = await sessaoDeDono()
  if (!session) return { error: "Você não tem permissão para isso." }
  const tenantId = session.user.tenantId

  const { error } = await supabaseAdmin
    .from("tenants")
    .update({ onboarding_profile_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", tenantId)

  if (error) return { error: "Não foi possível concluir. Tente novamente." }

  await logAudit({
    tenantId,
    actorId:    session.user.id,
    actorEmail: session.user.email ?? null,
    action:     "onboarding.completed",
    targetType: "tenant",
    targetId:   tenantId,
  })

  revalidatePath("/", "layout")
  return { ok: true }
}

/**
 * "Deixar pra depois".
 *
 * 🔑 Carimba a data em vez de esconder pra sempre: o dono decidiu que o cadastro pode ser
 *    pulado e que a cobrança é quem cobra o que falta. Guardar QUANDO pulou é o que
 *    permite responder "quanta gente pula?" — o número que diz se o wizard está bom ou
 *    está atrapalhando. Um booleano `dispensado` não responderia isso.
 */
export async function skipOnboarding(): Promise<{ error?: string; ok?: boolean }> {
  const session = await sessaoDeDono()
  if (!session) return { error: "Você não tem permissão para isso." }
  const tenantId = session.user.tenantId

  const { error } = await supabaseAdmin
    .from("tenants")
    .update({ onboarding_skipped_at: new Date().toISOString() })
    .eq("id", tenantId)

  if (error) return { error: "Não foi possível continuar. Tente novamente." }
  revalidatePath("/", "layout")
  return { ok: true }
}
