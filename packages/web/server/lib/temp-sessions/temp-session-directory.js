import path from 'path';
import fs from 'fs';
import os from 'os';

const fsPromises = fs.promises;
const TEMP_SESSIONS_DIR_NAME = 'temp-sessions';

function getTempSessionsBaseDir() {
  return path.join(os.homedir(), '.config', 'openchamber', TEMP_SESSIONS_DIR_NAME);
}

function sanitizeTopic(topic) {
  return topic
    .trim()
    .toLowerCase()
    .replace(/[\/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

function getTodayDir() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function generateUniqueDirName(baseDir, topic) {
  const sanitized = sanitizeTopic(topic);
  if (!sanitized) {
    return `untitled-${Date.now()}`;
  }

  let candidate = sanitized;
  let counter = 1;
  const maxAttempts = 1000;

  while (counter < maxAttempts) {
    const fullPath = path.join(baseDir, candidate);
    try {
      fs.accessSync(fullPath);
      candidate = `${sanitized}-${counter}`;
      counter++;
    } catch {
      return candidate;
    }
  }

  return `${sanitized}-${Date.now()}`;
}

export async function createTempSessionDirectory(topic) {
  const baseDir = getTempSessionsBaseDir();
  const todayDir = getTodayDir();
  const dateDir = path.join(baseDir, todayDir);
  const dirName = generateUniqueDirName(dateDir, topic);
  const fullPath = path.join(dateDir, dirName);

  await fsPromises.mkdir(fullPath, { recursive: true });

  return fullPath;
}

export async function listTempSessionDirectories() {
  const baseDir = getTempSessionsBaseDir();
  const results = [];

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
      }
    }
  } catch {
  }

  return results.sort((a, b) => b.createdAt - a.createdAt);
}

export async function cleanupOldTempSessions(maxAgeDays = 7) {
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

        if (!hasRemaining) {
          try {
            await fsPromises.rmdir(datePath);
          } catch {
          }
        }
      } catch {
        errors++;
      }
    }
  } catch {
  }

  return { deleted, errors };
}

export async function deleteTempSessionDirectory(dirPath) {
  try {
    await fsPromises.rm(dirPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export async function renameTempSessionDirectory(dirPath, newTopic) {
  const sanitized = sanitizeTopic(newTopic);
  if (!sanitized) {
    throw new Error('Invalid topic name');
  }

  const parentDir = path.dirname(dirPath);
  let candidate = sanitized;
  let counter = 1;

  while (counter < 1000) {
    const targetPath = path.join(parentDir, candidate);
    if (targetPath === dirPath) {
      return dirPath;
    }
    try {
      fs.accessSync(targetPath);
      candidate = `${sanitized}-${counter}`;
      counter++;
    } catch {
      break;
    }
  }

  const newPath = path.join(parentDir, candidate);
  await fsPromises.rename(dirPath, newPath);
  return newPath;
}
