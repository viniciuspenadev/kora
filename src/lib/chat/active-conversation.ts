"use client"

// Qual conversa está ABERTA na tela agora (o atendimento informa; o sininho lê). Aviso
// sobre a conversa que a pessoa já está vendo não toca nem fica como não-lido.
let active: string | null = null

export function setActiveConversation(id: string | null): void { active = id }
export function getActiveConversation(): string | null { return active }
