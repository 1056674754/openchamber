export const shareDataUrlAsFile = async (
  dataUrl: string,
  fileName: string,
  options: {
    fetchImpl?: typeof fetch;
    navigatorImpl?: Pick<Navigator, 'canShare' | 'share'>;
  } = {},
): Promise<void> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const navigatorImpl = options.navigatorImpl ?? navigator;
  const blob = await fetchImpl(dataUrl).then((response) => response.blob());
  const file = new File([blob], fileName, { type: blob.type || 'image/png' });
  if (!navigatorImpl.canShare?.({ files: [file] })) {
    throw new Error('File sharing is unavailable in this mobile runtime');
  }
  await navigatorImpl.share({ files: [file] });
};
