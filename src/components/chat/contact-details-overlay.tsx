"use client"

import type { ComponentProps } from "react"
import { ContactSidebar } from "./contact-sidebar"
import { ConversationDetailsOverlay } from "./conversation-details-overlay"

export function ContactDetailsOverlay({ open, onClose, ...props }: ComponentProps<typeof ContactSidebar> & { open: boolean; onClose: () => void }) {
  return <ConversationDetailsOverlay open={open} onClose={onClose} label="Detalhes do contato">
    <ContactSidebar {...props} forceExpanded onClose={onClose} />
  </ConversationDetailsOverlay>
}
