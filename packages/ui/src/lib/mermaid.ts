import type { MermaidConfig } from 'mermaid'

let mermaidModule: typeof import('mermaid')['default'] | null = null

async function getMermaid() {
  if (!mermaidModule) {
    const { default: mermaid } = await import('mermaid')
    mermaidModule = mermaid
  }
  return mermaidModule
}

export type MermaidThemeColors = {
  elevated: string
  foreground: string
  border: string
  accent: string
  mutedForeground: string
  muted: string
}

function buildConfig(colors: MermaidThemeColors): MermaidConfig {
  return {
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'strict',
    suppressErrorRendering: true,
    flowchart: {
      curve: 'basis',
      useMaxWidth: false,
      htmlLabels: true,
    },
    themeVariables: {
      background: 'transparent',
      primaryColor: colors.muted,
      primaryTextColor: colors.foreground,
      primaryBorderColor: colors.border,
      lineColor: colors.border,
      secondaryColor: colors.elevated,
      secondaryTextColor: colors.mutedForeground,
      tertiaryColor: colors.elevated,
      tertiaryTextColor: colors.foreground,
      textColor: colors.foreground,
      mainBkg: colors.muted,
      nodeBorder: colors.border,
      clusterBkg: colors.elevated,
      clusterBorder: colors.border,
      titleColor: colors.foreground,
      edgeLabelBackground: colors.elevated,
      fontFamily: '"IBM Plex Sans", sans-serif',
      fontSize: '13px',
    },
  }
}

let activeRenders = 0
const MAX_CONCURRENT = 2
const renderQueue: Array<() => void> = []

function acquireSlot(): Promise<void> {
  if (activeRenders < MAX_CONCURRENT) {
    activeRenders++
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    renderQueue.push(() => { activeRenders++; resolve() })
  })
}

function releaseSlot(): void {
  activeRenders--
  const next = renderQueue.shift()
  if (next) next()
}

let renderCounter = 0

export async function renderMermaidDiagram(
  source: string,
  colors: MermaidThemeColors,
): Promise<string> {
  await acquireSlot()
  try {
    const mermaid = await getMermaid()

    // 确保字体已加载完成:mermaid 的 dagre 布局引擎依赖 getBBox/getComputedTextLength
    // 测量文字尺寸,如果字体还没加载完(fallback 字体正在加载),测量会返回 0,
    // 导致所有节点塌缩到原点、viewBox 变成默认的 16x16。
    if (typeof document !== 'undefined' && document.fonts && document.fonts.status !== 'loaded') {
      try {
        await document.fonts.ready
      } catch {
        // 字体加载失败不应阻塞渲染
      }
    }

    const config = buildConfig(colors)
    mermaid.initialize(config)
    await mermaid.parse(source)
    const id = `mmd-${++renderCounter}`
    const { svg } = await mermaid.render(id, source)

    // 检测渲染是否塌缩:viewBox 16x16 是 mermaid 的空图表默认值。
    // 如果布局测量失败(节点位置全为 0),viewBox 会塌缩到这个值。
    const viewBoxMatch = svg.match(/viewBox="(-?[\d.]+)\s+(-?[\d.]+)\s+([\d.]+)\s+([\d.]+)"/)
    if (viewBoxMatch) {
      const vbW = parseFloat(viewBoxMatch[3])
      const vbH = parseFloat(viewBoxMatch[4])
      if (Number.isFinite(vbW) && Number.isFinite(vbH) && vbW <= 20 && vbH <= 20) {
        // 渲染塌缩 — 重试一次（此时字体已在上方 await 完毕）
        try {
          const retryId = `mmd-${++renderCounter}`
          const retry = await mermaid.render(retryId, source)
          return retry.svg
        } catch {
          // 重试也失败,返回原始 SVG
        }
      }
    }

    return svg
  } finally {
    releaseSlot()
  }
}
