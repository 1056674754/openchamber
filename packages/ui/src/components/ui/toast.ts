"use client"

import { isValidElement } from "react"
import { toast as sonnerToast } from "sonner"
import type { ExternalToast } from "sonner"
import { copyTextToClipboard } from '@/lib/clipboard'

type CopyableExternalToast = ExternalToast & {
  copyText?: string | (() => string)
}

const copyToClipboard = async (text: string) => {
  const result = await copyTextToClipboard(text)
  if (!result.ok) {
    console.error('Failed to copy to clipboard:', result.error)
  }
}

const reactNodeToText = (value: React.ReactNode): string => {
  if (value == null || typeof value === "boolean") {
    return ""
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.map(reactNodeToText).join(" ").trim()
  }
  if (isValidElement(value)) {
    const element = value as React.ReactElement<{ children?: React.ReactNode }>
    return reactNodeToText(element.props?.children)
  }
  return ""
}

const resolveToastDescription = (description: ExternalToast["description"]): React.ReactNode => {
  if (typeof description === "function") {
    return description()
  }
  return description
}

const getToastCopyText = (message: string | React.ReactNode, data?: CopyableExternalToast): string => {
  if (typeof data?.copyText === "function") {
    return data.copyText()
  }
  if (typeof data?.copyText === "string" && data.copyText.trim().length > 0) {
    return data.copyText
  }
  const descriptionText = reactNodeToText(resolveToastDescription(data?.description))
  if (descriptionText.length > 0) {
    return descriptionText
  }
  return reactNodeToText(message)
}

const withoutCopyText = (data?: CopyableExternalToast): ExternalToast | undefined => {
  if (!data) return undefined
  const rest: CopyableExternalToast = { ...data }
  delete rest.copyText
  return rest
}

// Wrapper to automatically add OK button to success and info toasts, Copy button to error and warning toasts
export const toast = {
  ...sonnerToast,
  success: (message: string | React.ReactNode, data?: CopyableExternalToast) => {
    const options = withoutCopyText(data)
    return sonnerToast.success(message, {
      ...options,
      action: data?.action || {
        label: 'OK',
        onClick: () => {},
      },
    })
  },
  info: (message: string | React.ReactNode, data?: CopyableExternalToast) => {
    const options = withoutCopyText(data)
    return sonnerToast.info(message, {
      ...options,
      action: data?.action || {
        label: 'OK',
        onClick: () => {},
      },
    })
  },
  error: (message: string | React.ReactNode, data?: CopyableExternalToast) => {
    const options = withoutCopyText(data)
    return sonnerToast.error(message, {
      ...options,
      action: data?.action || {
        label: 'Copy',
        onClick: () => copyToClipboard(getToastCopyText(message, data)),
      },
    })
  },
  warning: (message: string | React.ReactNode, data?: CopyableExternalToast) => {
    const options = withoutCopyText(data)
    return sonnerToast.warning(message, {
      ...options,
      action: data?.action || {
        label: 'Copy',
        onClick: () => copyToClipboard(getToastCopyText(message, data)),
      },
    })
  },
}
