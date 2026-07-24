const ARTIFACT_ID_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_INLINE_MIME_PATTERN = /^(?:image\/(?:avif|bmp|gif|jpeg|png|webp)|text\/plain|application\/pdf)$/;

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const parseArtifactManifest = (value, artifactId) => {
  if (!isRecord(value)) return null;
  if (value.version !== 1 || value.id !== artifactId) return null;
  if (typeof value.name !== 'string' || !value.name.trim()) return null;
  if (typeof value.mime !== 'string' || !value.mime.includes('/')) return null;
  if (typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size < 0) return null;
  if (typeof value.sha256 !== 'string' || !ARTIFACT_ID_PATTERN.test(value.sha256)) return null;
  return {
    name: value.name,
    mime: value.mime,
    size: value.size,
  };
};

const buildContentDisposition = (fileName) => {
  const asciiOnly = fileName
    .replace(/[^\u0020-\u007E]/g, '')
    .replace(/["\\]/g, '_');
  const fallback = asciiOnly || 'artifact';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

export const registerArtifactRoutes = (app, dependencies) => {
  const {
    fsPromises,
    path,
    openchamberDataDir,
  } = dependencies;
  const artifactRoot = path.join(openchamberDataDir, 'artifacts');

  app.get('/api/artifacts/:artifactId/content', async (req, res) => {
    const artifactId = typeof req.params.artifactId === 'string' ? req.params.artifactId.trim() : '';
    if (!ARTIFACT_ID_PATTERN.test(artifactId)) {
      return res.status(400).json({ error: 'Invalid artifact id' });
    }

    try {
      const artifactDirectory = path.join(artifactRoot, artifactId);
      const manifestText = await fsPromises.readFile(path.join(artifactDirectory, 'manifest.json'), 'utf8');
      const manifest = parseArtifactManifest(JSON.parse(manifestText), artifactId);
      if (!manifest) {
        return res.status(500).json({ error: 'Artifact manifest is invalid' });
      }

      const contentPath = path.join(artifactDirectory, 'content');
      const contentStats = await fsPromises.stat(contentPath);
      if (!contentStats.isFile() || contentStats.size !== manifest.size) {
        return res.status(500).json({ error: 'Artifact content is invalid' });
      }

      const download = req.query.download === 'true' || !SAFE_INLINE_MIME_PATTERN.test(manifest.mime);
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', manifest.mime);
      if (download) {
        res.setHeader('Content-Disposition', buildContentDisposition(path.basename(manifest.name)));
      }
      return res.sendFile(contentPath);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return res.status(500).json({ error: 'Artifact manifest is invalid' });
      }
      if (error && typeof error === 'object' && error.code === 'ENOENT') {
        return res.status(404).json({ error: 'Artifact not found' });
      }
      if (error && typeof error === 'object' && (error.code === 'EACCES' || error.code === 'EPERM')) {
        return res.status(403).json({ error: 'Access to artifact denied' });
      }
      console.error('Failed to read artifact:', error);
      return res.status(500).json({ error: 'Failed to read artifact' });
    }
  });
};
