/**
 * Temporary session directory management.
 * Creates and manages scratch directories for one-off conversations.
 * Directories are created under ~/.config/openchamber/temp/YYYY-MM-DD/{topic}/
 */

import path from 'path';
import fs from 'fs';
import os from 'os';

const fsPromises = fs.promises;

const TEMP_SESSIONS_DIR_NAME = 'temp-sessions';

function getTempSessionsBaseDir(): string {
  return path.join(os.homedir(), '.config', 'openchamber', TEMP_SESSIONS_DIR_NAME);
}

function sanitizeTopic(topic: string): string {
  // Remove or replace characters that are problematic in filesystem paths
  return topic
    .trim()
    .toLowerCase()
    // Replace Chinese punctuation and special chars with hyphen
    .replace(/[\/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50); // Limit length
}

function getTodayDir(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function generateUniqueDirName(baseDir: string, topic: string): string {
  const sanitized = sanitizeTopic(topic);
  if (!sanitized) {
    return `untitled-${Date.now()}`;
  }

  // Check if the directory already exists, append number if needed
  let candidate = sanitized;
  let counter = 1;
  const maxAttempts = 1000;

  while (counter < maxAttempts) {
    const fullPath = path.join(baseDir, candidate);
    try {
      fs.accessSync(fullPath);
      // Directory exists, try next
      candidate = `${sanitized}-${counter}`;
      counter++;
    } catch {
      // Directory doesn't exist, we can use this name
      return candidate;
    }
  }

  // Fallback with timestamp
  return `${sanitized}-${Date.now()}`;
}

export async function createTempSessionDirectory(topic: string): Promise<string> {
  const baseDir = getTempSessionsBaseDir();
  const todayDir = getTodayDir();
  const dateDir = path.join(baseDir, todayDir);
  const dirName = generateUniqueDirName(dateDir, topic);
  const fullPath = path.join(dateDir, dirName);

  await fsPromises.mkdir(fullPath, { recursive: true });

  return fullPath;
}

export async function listTempSessionDirectories(): Promise<Array<{
  path: string;
  topic: string;
  date: string;
  createdAt: number;
}>> {
  const baseDir = getTempSessionsBaseDir();
  const results: Array<{
    path: string;
    topic: string;
    date: string;
    createdAt: number;
  }> = [];

  try {
    const dateDirs = await fsPromises.readdir(baseDir, { withFileTypes: true });

    for (const dateDir of dateDirs) {
      if (!dateDir.isDirectory()) continue;
      const datePath = path.join(baseDir, dateDir.name);

      try {
        const topicDirs = await fsPromises.readdir(datePath, { withFileTypes: true });

        for (const topicDir of topicDirs) {
          if (!topicDir.isDirectory()) continue;
          const topicPath = path.join(datePath, topicDir.name);
          const stat = await fsPromises.stat(topicPath);

          results.push({
            path: topicPath,
            topic: topicDir.name,
            date: dateDir.name,
            createdAt: stat.birthtime.getTime(),
          });
        }
      } catch {
        // Ignore errors reading individual date directories
      }
    }
  } catch {
    // Base directory doesn't exist or can't be read
  }

  return results.sort((a, b) => b.createdAt - a.createdAt);
}

export async function cleanupOldTempSessions(maxAgeDays: number = 7): Promise<{
  deleted: number;
  errors: number;
}> {
  const baseDir = getTempSessionsBaseDir();
  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  let errors = 0;

  try {
    const dateDirs = await fsPromises.readdir(baseDir, { withFileTypes: true });

    for (const dateDir of dateDirs) {
      if (!dateDir.isDirectory()) continue;
      const datePath = path.join(baseDir, dateDir.name);

      try {
        const topicDirs = await fsPromises.readdir(datePath, { withFileTypes: true });
        let hasRemaining = false;

        for (const topicDir of topicDirs) {
          if (!topicDir.isDirectory()) continue;
          const topicPath = path.join(datePath, topicDir.name);

          try {
            const stat = await fsPromises.stat(topicPath);
            const age = now - stat.birthtime.getTime();

            if (age > maxAgeMs) {
              await fsPromises.rm(topicPath, { recursive: true, force: true });
              deleted++;
            } else {
              hasRemaining = true;
            }
          } catch {
            errors++;
          }
        }

        // Remove empty date directories
        if (!hasRemaining) {
          try {
            await fsPromises.rmdir(datePath);
          } catch {
            // Ignore errors removing date directories
          }
        }
      } catch {
        errors++;
      }
    }
  } catch {
    // Base directory doesn't exist
  }

  return { deleted, errors };
}

export async function deleteTempSessionDirectory(dirPath: string): Promise<boolean> {
  try {
    await fsPromises.rm(dirPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
