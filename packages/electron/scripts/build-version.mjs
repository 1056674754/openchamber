const SSITY_SUFFIX = '-sscity';

export const createBuildVersion = (sourceVersion, builtAt = new Date(), timeZone = 'Asia/Shanghai') => {
  if (typeof sourceVersion !== 'string' || !sourceVersion.endsWith(SSITY_SUFFIX)) {
    throw new Error(`OpenChamber build version must end with ${SSITY_SUFFIX}: got ${sourceVersion}`);
  }
  if (Number.isNaN(builtAt.getTime())) {
    throw new Error('OpenChamber build timestamp must be a valid Date');
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(builtAt);
  const value = (type) => parts.find((part) => part.type === type)?.value || '';
  const date = `${value('year')}${value('month')}${value('day')}`;
  const time = `${value('hour')}${value('minute')}${value('second')}`;

  // Use `YYYYMMDD-HHMMSS` as one prerelease identifier. A dotted time segment
  // like `.012323` is invalid semver (numeric identifiers cannot have leading
  // zeros), which crashes electron-updater for builds between 00:00 and 09:59.
  return `${sourceVersion}.${date}-${time}`;
};
