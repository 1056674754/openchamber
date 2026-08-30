type DirectorySetter = (directory: string) => void;

let currentDirectory: string | null = null;
let activeSetter: DirectorySetter | null = null;

export function setOpencodeDirectory(directory: string): void {
  currentDirectory = directory;
  activeSetter?.(directory);
}

export function getOpencodeDirectory(): string | null {
  return currentDirectory;
}

export function registerOpencodeDirectorySetter(setter: DirectorySetter): () => void {
  activeSetter = setter;
  if (currentDirectory) setter(currentDirectory);

  return () => {
    if (activeSetter === setter) activeSetter = null;
  };
}
