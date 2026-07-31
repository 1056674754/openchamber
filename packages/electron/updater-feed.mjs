const isLoopbackHostname = (hostname) => {
  if (hostname === '::1' || hostname === '[::1]') return true;
  const octets = hostname.split('.');
  if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet))) return false;
  const values = octets.map(Number);
  return values[0] === 127 && values.every((value) => value <= 255);
};

export const parseLoopbackUpdaterUrl = (value) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:')
      || !isLoopbackHostname(url.hostname)
      || url.username
      || url.password
      || url.search
      || url.hash) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

export const parseEmbeddedUpdaterUrl = (value) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:'
      || url.username
      || url.password
      || url.search
      || url.hash) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

export const resolveUpdaterFeed = ({
  environment = process.env,
  productionUrl = '',
  testBuild = false,
} = {}) => {
  if (environment.OPENCHAMBER_E2E === '1' && testBuild === true) {
    const url = parseLoopbackUpdaterUrl(environment.OPENCHAMBER_UPDATER_E2E_URL);
    if (url) return { provider: 'generic', url };
  }

  const url = parseEmbeddedUpdaterUrl(productionUrl);
  return url ? { provider: 'generic', url } : null;
};
