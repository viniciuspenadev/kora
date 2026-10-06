import {
  Sparkles, Wrench, House, Building2, CalendarDays, Clock, Truck, Package, Heart, Star,
  Shield, Zap, MapPin, FileText, MessageCircle, User, Users, Briefcase, DollarSign, CircleHelp,
  type LucideIcon,
} from "lucide-react"
import type { FormIcon } from "@/lib/forms/definition"

/** Nome em português de cada ícone (seletor do editor). */
export const FORM_ICON_LABEL: Record<FormIcon, string> = {
  "sparkles": "Novidade", "wrench": "Ferramenta", "home": "Casa", "building": "Prédio", "calendar": "Calendário",
  "clock": "Relógio", "truck": "Entrega", "package": "Pacote", "heart": "Coração", "star": "Estrela",
  "shield": "Proteção", "zap": "Rápido", "map-pin": "Local", "file-text": "Documento", "message-circle": "Conversa",
  "user": "Pessoa", "users": "Pessoas", "briefcase": "Trabalho", "dollar": "Dinheiro", "help-circle": "Dúvida",
}

/** Ícones dos cartões de escolha — espelha a lista FECHADA `FORM_ICONS` da definição. */
export const FORM_ICON: Record<FormIcon, LucideIcon> = {
  "sparkles": Sparkles, "wrench": Wrench, "home": House, "building": Building2, "calendar": CalendarDays,
  "clock": Clock, "truck": Truck, "package": Package, "heart": Heart, "star": Star,
  "shield": Shield, "zap": Zap, "map-pin": MapPin, "file-text": FileText, "message-circle": MessageCircle,
  "user": User, "users": Users, "briefcase": Briefcase, "dollar": DollarSign, "help-circle": CircleHelp,
}
