import { SidebarBody } from "@/components/app/sidebar-body"

interface Props {
  userName:        string
  userEmail:       string
  tenantName:      string
  userRole:        string
  enabledModules:  string[]   // slugs habilitados (vem do server layout)
  selfPause:      { paused: boolean; paused_until: string | null }
  hasOfficial?:   boolean     // tenant tem instância WhatsApp API Oficial
}

/**
 * Sidebar desktop — trilha de 64px que expande pra 256px no hover. Escondida no
 * mobile (`hidden md:flex`); abaixo de md a navegação vem do <MobileSidebar/>.
 */
export function Sidebar(props: Props) {
  return (
    <aside className="group/sb hidden md:flex flex-col bg-white border-r border-slate-200 shrink-0 h-dvh overflow-hidden z-20
      w-16 hover:w-64 transition-[width] duration-200 ease-in-out">
      <SidebarBody {...props} expanded={false} />
    </aside>
  )
}
