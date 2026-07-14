import React from 'react';

import { openExternalUrl } from '@/lib/url';
import {
  buildHtmlFilePreviewDocument,
  isHtmlFilePreviewNavigationMessage,
  resolveHtmlFilePreviewNavigation,
} from './htmlFilePreviewNavigation';

type HtmlFilePreviewProps = {
  readonly html: string;
  readonly filePath: string;
  readonly onOpenFile: (path: string) => void;
  readonly title: string;
};

export const HtmlFilePreview = ({ html, filePath, onOpenFile, title }: HtmlFilePreviewProps) => {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const srcDoc = React.useMemo(() => buildHtmlFilePreviewDocument(html), [html]);

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!isHtmlFilePreviewNavigationMessage(event.data)) return;

      const navigation = resolveHtmlFilePreviewNavigation(event.data.href, filePath);
      if (navigation.kind === 'external') {
        void openExternalUrl(navigation.url);
        return;
      }
      if (navigation.kind === 'file') {
        onOpenFile(navigation.path);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [filePath, onOpenFile]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      className="h-full w-full border-none"
      sandbox="allow-scripts allow-forms"
      title={title}
    />
  );
};
