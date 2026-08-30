import path from 'node:path';
import fsPromises from 'node:fs/promises';

export const SCREENSHOT_DIRECTORY = path.join('.openchamber', 'screenshots');
export const screenshotSlug = (label) => String(label ?? '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '') || 'page';

export const writeScreenshot = async ({ directory, base64, mime = 'image/jpeg', label, now = new Date(), fs = fsPromises }) => {
  if (typeof directory !== 'string' || !directory.trim()) throw new Error('A project directory is required to save a screenshot');
  if (typeof base64 !== 'string' || !base64) throw new Error('The browser returned no image');
  const extension = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
  const stamp = now.toISOString().replace(/[:.]/g, '-').replace('Z', '');
  const relativePath = path.join(SCREENSHOT_DIRECTORY, `${screenshotSlug(label)}-${stamp}${extension}`);
  const absolutePath = path.join(directory, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, Buffer.from(base64, 'base64'));
  return { path: relativePath.split(path.sep).join('/'), absolutePath };
};
