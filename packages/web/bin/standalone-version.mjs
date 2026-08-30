import packageMetadata from '../package.json' with { type: 'json' };

export const STANDALONE_VERSION = packageMetadata.version;
