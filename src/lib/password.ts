/**
 * Política de senha do Kora — fonte única.
 * Mínimo 8 caracteres + pelo menos uma letra E um número. Equilíbrio entre
 * segurança e atrito (não exige símbolo, que mais atrapalha que ajuda).
 * Retorna mensagem de erro em PT-BR, ou `null` se a senha é válida.
 *
 * Usada em TODO ponto que define senha: setup, convite, criação de tenant
 * (owner) e troca de senha no perfil.
 */
export function validatePassword(pw: string): string | null {
  if (!pw || pw.length < 8) return "A senha precisa ter pelo menos 8 caracteres."
  if (pw.length > 200)       return "Senha muito longa (máx. 200 caracteres)."
  if (!/[a-zA-Z]/.test(pw))  return "A senha precisa ter pelo menos uma letra."
  if (!/[0-9]/.test(pw))     return "A senha precisa ter pelo menos um número."
  return null
}
