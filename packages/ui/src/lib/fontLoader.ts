import { CJK_MONO_FONT_FACE_FAMILY, CJK_MONO_FONT_FAMILIES, CJK_MONO_FONT_URL, CODE_FONT_OPTION_MAP, UI_FONT_OPTION_MAP, type FontFaceSource, type MonoFontOption, type UiFontOption } from '@/lib/fontOptions';

declare global {
  interface Window {
    __openchamberDebugCodeFonts?: () => Promise<CodeFontDiagnostics>;
  }
}

const loadedFaces = new Set<string>();
const pendingFaces = new Map<string, Promise<void>>();

interface CodeFontSample {
  text: string;
  width: number;
  ratioToAscii: number | null;
}

interface CodeFontDiagnostics {
  cjkFontFamily: string;
  cjkFontLoaded: boolean | null;
  cjkFontUrl: string;
  elementFound: boolean;
  inlineFontFamily: string | null;
  computedFontFamily: string | null;
  computedFont: string | null;
  measurementFontFamily: string;
  cssFontMono: string;
  cssFontMonoCjk: string;
  samples: CodeFontSample[];
}

const buildFontUrl = (source: FontFaceSource, weight: number) => {
  if ('urls' in source) {
    return source.urls[weight];
  }

  const packageName = encodeURIComponent(source.packageName).replace('%40', '@').replace('%2F', '/');
  return `https://cdn.jsdelivr.net/npm/${packageName}/files/${source.filePrefix}-latin-${weight}-normal.woff2`;
};

const loadFace = (source: FontFaceSource, weight: number) => {
  const key = `${source.family}:${weight}`;
  if (loadedFaces.has(key)) {
    return Promise.resolve();
  }

  const pending = pendingFaces.get(key);
  if (pending) {
    return pending;
  }

  if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) {
    return Promise.resolve();
  }

  const face = new FontFace(source.family, `url(${buildFontUrl(source, weight)}) format('woff2')`, {
    style: 'normal',
    weight: String(weight),
    display: 'swap',
  });

  document.fonts.add(face);
  const promise = face.load()
    .then(() => {
      loadedFaces.add(key);
    })
    .catch((error) => {
      document.fonts.delete(face);
      console.warn(`Failed to load font: ${source.family} ${weight}`, error);
    })
    .finally(() => {
      pendingFaces.delete(key);
    });

  pendingFaces.set(key, promise);
  return promise;
};

const loadFaceFromUrl = (
  family: string,
  url: string,
  descriptors: FontFaceDescriptors,
  label = family
) => {
  const key = `${family}:${descriptors.weight ?? '400'}:${url}`;
  if (loadedFaces.has(key)) {
    return Promise.resolve();
  }

  const pending = pendingFaces.get(key);
  if (pending) {
    return pending;
  }

  if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) {
    return Promise.resolve();
  }

  const face = new FontFace(family, `url(${url}) format('woff2')`, descriptors);

  document.fonts.add(face);
  const promise = face.load()
    .then(() => {
      loadedFaces.add(key);
    })
    .catch((error) => {
      document.fonts.delete(face);
      console.warn(`Failed to load font: ${label}`, error);
    })
    .finally(() => {
      pendingFaces.delete(key);
    });

  pendingFaces.set(key, promise);
  return promise;
};

const loadSource = (source: FontFaceSource | undefined) => {
  if (!source) {
    return Promise.resolve();
  }

  return Promise.all(source.weights.map((weight) => loadFace(source, weight))).then(() => undefined);
};

export const loadUiFont = (font: UiFontOption) => loadSource(UI_FONT_OPTION_MAP[font]?.source);

export const loadMonoFont = (font: MonoFontOption) => loadSource(CODE_FONT_OPTION_MAP[font]?.source);

export const loadCjkMonoFont = () => loadFaceFromUrl(CJK_MONO_FONT_FACE_FAMILY, CJK_MONO_FONT_URL, {
  style: 'normal',
  weight: '100 800',
  display: 'swap',
}, `${CJK_MONO_FONT_FACE_FAMILY} (CJK code blocks)`);

const CODE_FONT_DIAGNOSTIC_SAMPLES = ['a', 'aa', '中', '中文', '─', '──', '│', '①', '✅', '✓'];
const EMOJI_PRESENTATION_PATTERN = /\p{Emoji_Presentation}/u;

const isDiagnosticWideCodePoint = (codePoint: number): boolean => (
  (codePoint >= 0x1100 && codePoint <= 0x115f) ||
  codePoint === 0x2329 ||
  codePoint === 0x232a ||
  (codePoint >= 0x2460 && codePoint <= 0x24ff) ||
  (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
  (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
  (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
  (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
  (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
  (codePoint >= 0xff00 && codePoint <= 0xff60) ||
  (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
  (codePoint >= 0x1f300 && codePoint <= 0x1faff)
);

const getDiagnosticCellWidth = (segment: string): '0' | '1' | '2' => {
  if (!segment) return '0';
  if (EMOJI_PRESENTATION_PATTERN.test(segment)) return '2';
  const codePoint = segment.codePointAt(0);
  if (codePoint === undefined) return '0';
  if (codePoint === 0 || codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return '0';
  return isDiagnosticWideCodePoint(codePoint) ? '2' : '1';
};

const getCodeFontDiagnosticElement = () => document.querySelector<HTMLElement>(
  '.markdown-content pre, .markdown-content [data-markdown="code-block-body"], [data-component="markdown-code-body"] pre'
);

const appendMeasuredText = (target: HTMLElement, text: string) => {
  Array.from(text).forEach((segment) => {
    const cell = document.createElement('span');
    cell.setAttribute('data-openchamber-code-cell', getDiagnosticCellWidth(segment));

    if (EMOJI_PRESENTATION_PATTERN.test(segment)) {
      const emoji = document.createElement('span');
      emoji.setAttribute('data-openchamber-code-wide-emoji', 'true');
      emoji.textContent = segment;
      cell.append(emoji);
    } else {
      cell.textContent = segment;
    }

    target.append(cell);
  });
};

const measureSamples = ({
  fontFamily,
  fontSize,
  fontWeight,
}: {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
}): CodeFontSample[] => {
  const container = document.createElement('pre');
  container.className = 'markdown-content';
  container.style.position = 'absolute';
  container.style.left = '-10000px';
  container.style.top = '-10000px';
  container.style.opacity = '0';
  container.style.pointerEvents = 'none';
  container.style.whiteSpace = 'pre';
  container.style.fontFamily = fontFamily;
  container.style.fontSize = fontSize;
  container.style.fontWeight = fontWeight;
  container.style.fontVariantLigatures = 'none';
  container.style.fontFeatureSettings = '"liga" 0, "calt" 0';
  document.body.append(container);

  const measure = (text: string) => {
    const sample = document.createElement('span');
    sample.style.display = 'inline-block';
    appendMeasuredText(sample, text);
    container.append(sample);
    const width = sample.getBoundingClientRect().width;
    sample.remove();
    return width;
  };

  const asciiWidth = measure('a');

  const samples = CODE_FONT_DIAGNOSTIC_SAMPLES.map((text) => {
    const width = measure(text);
    return {
      text,
      width,
      ratioToAscii: asciiWidth > 0 ? width / asciiWidth : null,
    };
  });

  container.remove();
  return samples;
};

const getCodeFontDiagnostics = async (): Promise<CodeFontDiagnostics> => {
  await loadCjkMonoFont();
  if (typeof document.fonts?.ready?.then === 'function') {
    await document.fonts.ready;
  }

  const element = getCodeFontDiagnosticElement();
  const computed = element ? window.getComputedStyle(element) : null;
  const root = window.getComputedStyle(document.documentElement);
  const computedFont = computed?.font ?? null;
  const measurementFontFamily = computed?.fontFamily || `${CJK_MONO_FONT_FAMILIES}, var(--font-mono)`;

  return {
    cjkFontFamily: CJK_MONO_FONT_FACE_FAMILY,
    cjkFontLoaded: document.fonts?.check
      ? document.fonts.check(`16px "${CJK_MONO_FONT_FACE_FAMILY}"`, '中文')
      : null,
    cjkFontUrl: CJK_MONO_FONT_URL,
    elementFound: Boolean(element),
    inlineFontFamily: element?.style.fontFamily || null,
    computedFontFamily: computed?.fontFamily ?? null,
    computedFont,
    measurementFontFamily,
    cssFontMono: root.getPropertyValue('--font-mono').trim(),
    cssFontMonoCjk: root.getPropertyValue('--font-mono-cjk').trim(),
    samples: measureSamples({
      fontFamily: measurementFontFamily,
      fontSize: computed?.fontSize || '14px',
      fontWeight: computed?.fontWeight || '400',
    }),
  };
};

export const installCodeFontDiagnostics = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  window.__openchamberDebugCodeFonts = async () => {
    const diagnostics = await getCodeFontDiagnostics();
    console.info('[OpenChamber] code font diagnostics', diagnostics);
    console.table(diagnostics.samples);
    return diagnostics;
  };
};
