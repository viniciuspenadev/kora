import { requireModule } from "@/lib/modules"
import { getViewerScope } from "@/lib/visibility"
import { TasksClient } from "@/components/crm/tasks-client"
export default async function TasksPage() {
  await getViewerScope()
  await requireModule("crm")
  return <TasksClient/>
}
