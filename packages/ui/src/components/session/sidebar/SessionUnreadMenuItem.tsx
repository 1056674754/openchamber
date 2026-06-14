import React from "react"

import { Icon } from "@/components/icon/Icon"
import { toast } from "@/components/ui"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { useI18n } from "@/lib/i18n"
import { markSessionUnread } from "@/sync/notification-store"

type SessionUnreadMenuItemProps = {
  sessionId: string
  isUnread: boolean
}

export function SessionUnreadMenuItem({ sessionId, isUnread }: SessionUnreadMenuItemProps): React.ReactElement | null {
  const { t } = useI18n()
  const [isSaving, setIsSaving] = React.useState(false)

  const handleSelect = React.useCallback(() => {
    if (isSaving) return
    setIsSaving(true)

    void markSessionUnread(sessionId)
      .then((ok) => {
        if (!ok) {
          toast.error(t("sessions.sidebar.session.unread.markUnreadError"))
        }
      })
      .finally(() => {
        setIsSaving(false)
      })
  }, [isSaving, sessionId, t])

  if (isUnread) return null

  return (
    <DropdownMenuItem onClick={handleSelect} disabled={isSaving} className="[&>svg]:mr-1">
      <Icon name="notification-3" className="mr-1 h-4 w-4" />
      {t("sessions.sidebar.session.menu.markUnread")}
    </DropdownMenuItem>
  )
}
