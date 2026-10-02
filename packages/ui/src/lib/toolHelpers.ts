export interface ToolMetadata {
  displayName: string;
  icon?: string;
  outputLanguage?: string;
  inputFields?: {
    key: string;
    label: string;
    type: 'command' | 'file' | 'pattern' | 'text' | 'code';
    language?: string;
  }[];
  category: 'file' | 'search' | 'code' | 'system' | 'ai' | 'web';
}

export const TOOL_METADATA: Record<string, ToolMetadata> = {

  read: {
    displayName: 'Read File',
    category: 'file',
    outputLanguage: 'auto',
    inputFields: [
      { key: 'filePath', label: 'File Path', type: 'file' },
      { key: 'offset', label: 'Start Line', type: 'text' },
      { key: 'limit', label: 'Lines to Read', type: 'text' }
    ]
  },
  write: {
    displayName: 'Write File',
    category: 'file',
    outputLanguage: 'auto',
    inputFields: [
      { key: 'filePath', label: 'File Path', type: 'file' },
      { key: 'content', label: 'Content', type: 'code' }
    ]
  },
  publish_artifact: {
    displayName: 'Publish Artifact',
    category: 'file',
    outputLanguage: 'text',
    inputFields: [
      { key: 'path', label: 'File Path', type: 'file' },
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'description', label: 'Description', type: 'text' },
    ],
  },
  edit: {
    displayName: 'Edit File',
    category: 'file',
    outputLanguage: 'diff',
    inputFields: [
      { key: 'filePath', label: 'File Path', type: 'file' },
      { key: 'oldString', label: 'Find', type: 'code' },
      { key: 'newString', label: 'Replace', type: 'code' },
      { key: 'replaceAll', label: 'Replace All', type: 'text' }
    ]
  },
  multiedit: {
    displayName: 'Multi-Edit',
    category: 'file',
    outputLanguage: 'diff',
    inputFields: [
      { key: 'filePath', label: 'File Path', type: 'file' },
      { key: 'edits', label: 'Edits', type: 'code', language: 'json' }
    ]
  },
  apply_patch: {
    displayName: 'Apply Patch',
    category: 'file',
    outputLanguage: 'diff',
    inputFields: [
      { key: 'patchText', label: 'Patch', type: 'code', language: 'diff' }
    ]
  },

  bash: {
    displayName: 'Shell Command',
    category: 'system',
    outputLanguage: 'text',
    inputFields: [
      { key: 'command', label: 'Command', type: 'command', language: 'bash' },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'timeout', label: 'Timeout (ms)', type: 'text' }
    ]
  },

  grep: {
    displayName: 'Search Files',
    category: 'search',
    outputLanguage: 'text',
    inputFields: [
      { key: 'pattern', label: 'Pattern', type: 'pattern' },
      { key: 'path', label: 'Directory', type: 'file' },
      { key: 'include', label: 'Include Pattern', type: 'pattern' }
    ]
  },
  glob: {
    displayName: 'Find Files',
    category: 'search',
    outputLanguage: 'text',
    inputFields: [
      { key: 'pattern', label: 'Pattern', type: 'pattern' },
      { key: 'path', label: 'Directory', type: 'file' }
    ]
  },
  list: {
    displayName: 'List Directory',
    category: 'file',
    outputLanguage: 'text',
    inputFields: [
      { key: 'path', label: 'Directory', type: 'file' },
      { key: 'ignore', label: 'Ignore Patterns', type: 'pattern' }
    ]
  },

  task: {
    displayName: 'Agent Task',
    category: 'ai',
    outputLanguage: 'markdown',
    inputFields: [
      { key: 'description', label: 'Task', type: 'text' },
      { key: 'prompt', label: 'Instructions', type: 'text' },
      { key: 'subagent_type', label: 'Agent Type', type: 'text' }
    ]
  },

  look_at: {
    displayName: 'Inspect Media',
    category: 'ai',
    outputLanguage: 'markdown',
    inputFields: [
      { key: 'file_path', label: 'File', type: 'file' },
      { key: 'file_paths', label: 'Files', type: 'file' },
      { key: 'goal', label: 'Goal', type: 'text' },
    ]
  },

  webfetch: {
    displayName: 'Fetch URL',
    category: 'web',
    outputLanguage: 'auto',
    inputFields: [
      { key: 'url', label: 'URL', type: 'text' },
      { key: 'format', label: 'Format', type: 'text' },
      { key: 'timeout', label: 'Timeout', type: 'text' }
    ]
  },

   websearch: {
     displayName: 'Web Search',
     category: 'web',
     outputLanguage: 'markdown',
     inputFields: [
       { key: 'query', label: 'Search Query', type: 'text' },
       { key: 'numResults', label: 'Results Count', type: 'text' },
       { key: 'type', label: 'Search Type', type: 'text' }
     ]
   },
   codesearch: {
     displayName: 'Code Search',
     category: 'web',
     outputLanguage: 'markdown',
     inputFields: [
       { key: 'query', label: 'Search Query', type: 'text' },
       { key: 'tokensNum', label: 'Tokens', type: 'text' }
     ]
   },

   todowrite: {
     displayName: 'Update Todo List',
     category: 'system',
     outputLanguage: 'json',
     inputFields: [
       { key: 'todos', label: 'Todo Items', type: 'code', language: 'json' }
     ]
   },
   todoread: {
     displayName: 'Read Todo List',
     category: 'system',
     outputLanguage: 'json',
     inputFields: []
   },
   skill: {
     displayName: 'Load Skill',
     category: 'ai',
     outputLanguage: 'markdown',
     inputFields: [
       { key: 'name', label: 'Skill Name', type: 'text' }
     ]
   },
   question: {
       displayName: 'Question',
       category: 'ai',
       outputLanguage: 'text',
       inputFields: [
         { key: 'questions', label: 'Questions', type: 'code', language: 'json' }
       ]
     },

    lsp: {
      displayName: 'LSP',
      category: 'code',
      outputLanguage: 'json',
      inputFields: [
        { key: 'operation', label: 'Operation', type: 'text' },
        { key: 'filePath', label: 'File Path', type: 'file' },
        { key: 'line', label: 'Line', type: 'text' },
        { key: 'character', label: 'Character', type: 'text' },
        { key: 'query', label: 'Query', type: 'text' }
      ]
    },

     openchamber_notify: {
      displayName: 'OpenChamber Notify',
      category: 'system',
      outputLanguage: 'json',
      inputFields: []
    },

    plan_enter: {
      displayName: 'Plan Mode',
      category: 'ai',
      outputLanguage: 'text',
      inputFields: []
    },

    plan_exit: {
      displayName: 'Build Mode',
      category: 'ai',
      outputLanguage: 'text',
      inputFields: []
    },

    StructuredOutput: {
      displayName: 'Structured Output',
      category: 'ai',
      outputLanguage: 'json',
      inputFields: []
    },

    structuredoutput: {
      displayName: 'Structured Output',
      category: 'ai',
      outputLanguage: 'json',
      inputFields: []
    }
  };

function formatUnknownToolDisplayName(toolName: string): string {
  const words = toolName
    .trim()
    .replace(/[._:/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean);
  const actionWords = new Set([
    'add', 'analyze', 'call', 'create', 'delete', 'download', 'execute', 'extract',
    'fetch', 'find', 'get', 'inspect', 'list', 'look', 'query', 'read', 'run',
    'search', 'send', 'update', 'upload', 'write',
  ]);
  const actionIndex = words.findIndex((word) => actionWords.has(word.toLowerCase()));
  const displayWords = actionIndex > 0 && actionIndex < words.length - 1
    ? words.slice(actionIndex)
    : words;

  return displayWords.join(' ').replace(/^./, (char) => char.toUpperCase());
}

export function getToolMetadata(toolName: string): ToolMetadata {
  return TOOL_METADATA[toolName] || {
    displayName: formatUnknownToolDisplayName(toolName),
    category: 'system',
    outputLanguage: 'text',
    inputFields: []
  };
}

export function detectToolOutputLanguage(
  toolName: string,
  output: string,
  input?: Record<string, unknown>
): string {
  const metadata = getToolMetadata(toolName);

  if (metadata.outputLanguage === 'auto') {

    if (input?.filePath || input?.file_path || input?.sourcePath) {
      const filePath = (input.filePath || input.file_path || input.sourcePath) as string;
      const language = getLanguageFromExtension(filePath);
      if (language) return language;
    }

    if (toolName === 'webfetch') {
      if (output.trim().startsWith('{') || output.trim().startsWith('[')) {
        try {
          JSON.parse(output);
          return 'json';
        } catch { /* ignored */ }
      }
      if (output.trim().startsWith('<')) {
        return 'html';
      }
      if (output.includes('```')) {
        return 'markdown';
      }
    }

    return 'text';
  }

  return metadata.outputLanguage || 'text';
}

export function getLanguageFromExtension(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  
  // Handle special filenames without extensions
  const filename = filePath.split('/').pop()?.toLowerCase() || '';
  const filenameMap: Record<string, string> = {
    'dockerfile': 'dockerfile',
    'makefile': 'makefile',
    'gnumakefile': 'makefile',
    'cmakelists.txt': 'cmake',
    'gemfile': 'ruby',
    'rakefile': 'ruby',
    'podfile': 'ruby',
    'vagrantfile': 'ruby',
    'guardfile': 'ruby',
    'brewfile': 'ruby',
    'fastfile': 'ruby',
    'appfile': 'ruby',
    'matchfile': 'ruby',
    'pluginfile': 'ruby',
    'scanfile': 'ruby',
    'snapfile': 'ruby',
    '.gitignore': 'text',
    '.gitattributes': 'text',
    '.gitmodules': 'ini',
    '.editorconfig': 'ini',
    '.npmrc': 'ini',
    '.yarnrc': 'yaml',
    '.prettierrc': 'json',
    '.eslintrc': 'json',
    '.babelrc': 'json',
    '.browserslistrc': 'text',
    'tsconfig.json': 'jsonc',
    'jsconfig.json': 'jsonc',
    '.env': 'bash',
    '.env.local': 'bash',
    '.env.development': 'bash',
    '.env.production': 'bash',
    '.env.test': 'bash',
    'procfile': 'yaml',
    'codeowners': 'text',
    // Lock files
    'package-lock.json': 'json',
    'composer.lock': 'json',
    'yarn.lock': 'yaml',
    'pnpm-lock.yaml': 'yaml',
    'cargo.lock': 'toml',
    'poetry.lock': 'toml',
    'gemfile.lock': 'ruby',
    'pubspec.lock': 'yaml',
    'packages.lock.json': 'json',
    'bun.lockb': 'text',
    'bun.lock': 'json',
  };
  
  if (filenameMap[filename]) {
    return filenameMap[filename];
  }

  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript
    'js': 'javascript',
    'jsx': 'jsx',
    'ts': 'typescript',
    'tsx': 'tsx',
    'mjs': 'javascript',
    'cjs': 'javascript',
    'mts': 'typescript',
    'cts': 'typescript',

    // Web markup/styling
    'html': 'html',
    'htm': 'html',
    'xhtml': 'html',
    'vue': 'html',
    'svelte': 'html',
    'astro': 'html',
    'ejs': 'html',
    'hbs': 'handlebars',
    'handlebars': 'handlebars',
    'mustache': 'handlebars',
    'njk': 'twig',
    'nunjucks': 'twig',
    'twig': 'twig',
    'liquid': 'liquid',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'less': 'less',
    'styl': 'stylus',
    'stylus': 'stylus',
    'pcss': 'css',
    'postcss': 'css',

    // Data/config formats
    'json': 'json',
    'jsonc': 'json',
    'json5': 'json',
    'jsonl': 'json',
    'ndjson': 'json',
    'geojson': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'toml': 'toml',
    'xml': 'xml',
    'xsl': 'xml',
    'xslt': 'xml',
    'xsd': 'xml',
    'dtd': 'xml',
    'plist': 'xml',
    'svg': 'xml',
    'rss': 'xml',
    'atom': 'xml',
    'xaml': 'xml',
    'csproj': 'xml',
    'vbproj': 'xml',
    'fsproj': 'xml',
    'props': 'xml',
    'targets': 'xml',
    'nuspec': 'xml',
    'resx': 'xml',
    'ini': 'ini',
    'cfg': 'ini',
    'conf': 'ini',
    'config': 'ini',
    'properties': 'properties',
    'env': 'bash',
    'csv': 'text',
    'tsv': 'text',

    // Python
    'py': 'python',
    'pyw': 'python',
    'pyx': 'python',
    'pxd': 'python',
    'pxi': 'python',
    'pyi': 'python',
    'gyp': 'python',
    'gypi': 'python',
    'bzl': 'python',

    // Ruby
    'rb': 'ruby',
    'erb': 'erb',
    'rake': 'ruby',
    'gemspec': 'ruby',
    'ru': 'ruby',
    'podspec': 'ruby',
    'thor': 'ruby',
    'jbuilder': 'ruby',
    'rabl': 'ruby',
    'builder': 'ruby',

    // PHP
    'php': 'php',
    'phtml': 'php',
    'php3': 'php',
    'php4': 'php',
    'php5': 'php',
    'php7': 'php',
    'phps': 'php',
    'inc': 'php',
    'blade.php': 'php',

    // Java/JVM
    'java': 'java',
    'kt': 'kotlin',
    'kts': 'kotlin',
    'scala': 'scala',
    'sc': 'scala',
    'groovy': 'groovy',
    'gradle': 'groovy',
    'gvy': 'groovy',
    'gy': 'groovy',
    'gsh': 'groovy',

    // C/C++/Objective-C
    'c': 'c',
    'h': 'c',
    'cpp': 'cpp',
    'cc': 'cpp',
    'cxx': 'cpp',
    'c++': 'cpp',
    'hpp': 'cpp',
    'hxx': 'cpp',
    'hh': 'cpp',
    'h++': 'cpp',
    'ino': 'cpp',
    'm': 'objectivec',
    'mm': 'objectivec',

    // C#/F#/.NET
    'cs': 'csharp',
    'csx': 'csharp',
    'cake': 'csharp',
    'fs': 'fsharp',
    'fsx': 'fsharp',
    'fsi': 'fsharp',
    'vb': 'vbnet',

    // Go
    'go': 'go',
    'mod': 'go',
    'sum': 'text',

    // Rust
    'rs': 'rust',

    // Swift
    'swift': 'swift',

    // Dart
    'dart': 'dart',

    // Lua
    'lua': 'lua',

    // Perl
    'pl': 'perl',
    'pm': 'perl',
    'pod': 'perl',
    't': 'perl',

    // R
    'r': 'r',
    'R': 'r',
    'rmd': 'markdown',
    'rnw': 'r',

    // Julia
    'jl': 'julia',

    // Haskell
    'hs': 'haskell',
    'lhs': 'haskell',

    // Elixir/Erlang
    'ex': 'elixir',
    'exs': 'elixir',
    'eex': 'html',
    'heex': 'html',
    'leex': 'html',
    'erl': 'erlang',
    'hrl': 'erlang',

    // Clojure
    'clj': 'clojure',
    'cljs': 'clojure',
    'cljc': 'clojure',
    'edn': 'clojure',

    // Lisp/Scheme
    'lisp': 'lisp',
    'cl': 'lisp',
    'el': 'lisp',
    'scm': 'scheme',
    'ss': 'scheme',
    'rkt': 'scheme',

    // OCaml/ReasonML
    'ml': 'ocaml',
    'mli': 'ocaml',
    're': 'reason',
    'rei': 'reason',

    // Nim
    'nim': 'nim',
    'nims': 'nim',
    'nimble': 'nim',

    // Zig
    'zig': 'zig',

    // V
    'v': 'v',
    'vsh': 'v',

    // Crystal
    'cr': 'crystal',

    // D
    'd': 'd',
    'di': 'd',

    // Shell/Scripts
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
    'fish': 'bash',
    'ksh': 'bash',
    'csh': 'bash',
    'tcsh': 'bash',
    'ps1': 'powershell',
    'psm1': 'powershell',
    'psd1': 'powershell',
    'bat': 'batch',
    'cmd': 'batch',

    // SQL
    'sql': 'sql',
    'psql': 'sql',
    'plsql': 'sql',
    'mysql': 'sql',
    'pgsql': 'sql',
    'sqlite': 'sql',

    // GraphQL
    'graphql': 'graphql',
    'gql': 'graphql',

    // Solidity
    'sol': 'solidity',

    // Assembly
    'asm': 'nasm',
    's': 'nasm',
    'S': 'nasm',

    // Nix
    'nix': 'nix',

    // Terraform/HCL
    'tf': 'hcl',
    'tfvars': 'hcl',
    'hcl': 'hcl',

    // Docker
    'dockerignore': 'text',

    // Puppet
    'pp': 'puppet',

    // LaTeX
    'tex': 'latex',
    'latex': 'latex',
    'sty': 'latex',
    'cls': 'latex',
    'bib': 'bibtex',
    'bst': 'bibtex',

    // Markdown/docs
    'md': 'markdown',
    'mdx': 'markdown',
    'markdown': 'markdown',
    'mdown': 'markdown',
    'mkd': 'markdown',
    'rst': 'text',
    'adoc': 'asciidoc',
    'asciidoc': 'asciidoc',
    'org': 'text',
    'txt': 'text',
    'text': 'text',
    'rtf': 'text',

    // Vim
    'vim': 'vim',
    'vimrc': 'vim',

    // Makefile variants
    'mk': 'makefile',

    // CMake
    'cmake': 'cmake',

    // Diff/Patch
    'diff': 'diff',
    'patch': 'diff',



    // Prisma
    'prisma': 'prisma',

    // Protocol Buffers
    'proto': 'protobuf',

    // Thrift
    'thrift': 'thrift',

    // WASM
    'wat': 'wasm',
    'wast': 'wasm',



    // GLSL/Shaders
    'glsl': 'glsl',
    'vert': 'glsl',
    'frag': 'glsl',
    'geom': 'glsl',
    'comp': 'glsl',
    'hlsl': 'hlsl',
    'fx': 'hlsl',
    'cg': 'cg',
    'shader': 'glsl',

    // Apache/Nginx config
    'htaccess': 'apacheconf',
    'nginx': 'nginx',

    // Kubernetes
    'kubeconfig': 'yaml',

    // Ansible
    'ansible': 'yaml',
  };

  return languageMap[ext || ''] || null;
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'avif'];

export function isImageFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext || '');
}

export function isPdfFile(filePath: string): boolean {
  return getFileExtension(filePath) === 'pdf';
}

export function isSvgFile(filePath: string): boolean {
  return getFileExtension(filePath) === 'svg';
}

// Playable in a browser media element: the viewer plays these instead of
// offering a download. What a runtime's engine cannot decode (an HEVC .mov,
// a .mkv) still opens; the element reports the failure and the viewer says so.
const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'weba'];
const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv'];
const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2'];

export function isAudioFile(filePath: string): boolean {
  return AUDIO_EXTENSIONS.includes(getFileExtension(filePath));
}

export function isVideoFile(filePath: string): boolean {
  return VIDEO_EXTENSIONS.includes(getFileExtension(filePath));
}

export function isFontFile(filePath: string): boolean {
  return FONT_EXTENSIONS.includes(getFileExtension(filePath));
}

/** Comma- or tab-separated text the viewer can lay out as a table. */
export function isDelimitedTableFile(filePath: string): boolean {
  const ext = getFileExtension(filePath);
  return ext === 'csv' || ext === 'tsv';
}

export function isMermaidFile(filePath: string): boolean {
  const ext = getFileExtension(filePath);
  return ext === 'mmd' || ext === 'mermaid';
}

const BINARY_FILE_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  'zip', 'rar', '7z', 'gz', 'tgz', 'tar', 'bz2', 'xz', 'jar', 'war', 'apk', 'dmg', 'iso',
  'deb', 'rpm', 'msi',
  ...IMAGE_EXTENSIONS.filter((extension) => extension !== 'svg'),
  'mp3', 'mp4', 'm4a', 'aac', 'flac', 'ogg', 'wav', 'wma', 'avi', 'mov', 'mkv', 'webm', 'wmv',
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  'exe', 'dll', 'so', 'dylib', 'bin', 'class', 'o', 'a', 'lib', 'wasm', 'node',
  'sqlite', 'sqlite3', 'db', 'dat', 'parquet', 'feather', 'pickle', 'pyc', 'pyo', 'lockb',
]);

export function getFileExtension(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) {
    return '';
  }
  return base.slice(dot + 1).toLowerCase();
}

export function isBinaryFile(filePath: string): boolean {
  if (isSvgFile(filePath)) {
    return false;
  }
  return BINARY_FILE_EXTENSIONS.has(getFileExtension(filePath));
}

export function looksLikeBinaryText(content: string): boolean {
  if (!content) {
    return false;
  }

  const sample = content.length > 8192 ? content.slice(0, 8192) : content;
  if (sample.includes('\0') || sample.startsWith('%PDF')) {
    return true;
  }
  if (sample.startsWith('PK\u0003\u0004') || sample.startsWith('PK\u0005\u0006') || sample.startsWith('PK\u0007\u0008')) {
    return true;
  }

  let suspicious = 0;
  for (let index = 0; index < sample.length; index += 1) {
    const code = sample.charCodeAt(index);
    if (code === 0xFFFD || code < 9 || (code > 13 && code < 32) || code === 127) {
      suspicious += 1;
    }
  }
  return suspicious / sample.length > 0.1;
}

export function getImageMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'webp': 'image/webp',
    'ico': 'image/x-icon',
    'bmp': 'image/bmp',
    'avif': 'image/avif',
  };
  return mimeMap[ext || ''] || 'image/png';
}

const SENSITIVE_TOOL_INPUT_KEY_PATTERN = /(?:^|_)(?:api_?key|(?:access|private|secret|signing|ssh)_?key|auth|authorization|cookies?|credentials?|pass(?:word|wd)|secrets?|tokens?)(?:_|$)/i;

export function isSensitiveToolInputKey(key: string): boolean {
  const normalizedKey = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s.-]+/g, '_')
    .toLowerCase();
  return SENSITIVE_TOOL_INPUT_KEY_PATTERN.test(normalizedKey);
}

function sanitizeToolInputValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeToolInputValue);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      isSensitiveToolInputKey(key) ? '[redacted]' : sanitizeToolInputValue(nestedValue),
    ]),
  );
}

export function sanitizeToolInputForDisplay(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      isSensitiveToolInputKey(key) ? '[redacted]' : sanitizeToolInputValue(value),
    ]),
  );
}

const DIAGRAM_EXTENSIONS = ['drawio', 'dio'];

export function isDrawioFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return DIAGRAM_EXTENSIONS.includes(ext || '');
}

export function formatToolInput(input: Record<string, unknown>, toolName: string): string {
  if (!input) return '';
  const displayInput = sanitizeToolInputForDisplay(input);

  const getString = (key: string): string | null => {
    const val = displayInput[key];
    return typeof val === 'string' ? val : (typeof val === 'number' ? String(val) : null);
  };

  if (toolName === 'bash') {
    const cmd = getString('command');
    if (cmd) return cmd;
  }

  if (toolName === 'lsp') {
    const operation = getString('operation') || 'lsp';
    const filePath = getString('filePath') || getString('file_path') || getString('path');
    const line = getString('line');
    const character = getString('character');
    const query = getString('query');
    const position = line && character ? ` (Line: ${line}; Character: ${character})` : '';

    if (operation === 'workspaceSymbol') {
      return query ? `Operation: ${operation} (Query: "${query}")` : `Operation: ${operation}`;
    }

    const summary = `Operation: ${operation}${position}`;
    if (filePath) {
      return `${summary}\n${filePath}`;
    }

    return summary;
  }

  if (toolName === 'task') {
    const prompt = getString('prompt');
    if (prompt) return prompt;
    const desc = getString('description');
    if (desc) return desc;
  }

  if (toolName === 'apply_patch' && typeof displayInput === 'object') {
    const patchText = getString('patchText') || getString('patch_text') || getString('patch');
    if (patchText) {
      return patchText;
    }
  }

  if ((toolName === 'edit' || toolName === 'multiedit') && typeof displayInput === 'object') {
    const filePath = getString('filePath') || getString('file_path') || getString('path');
    if (filePath) {
      return `File path: ${filePath}`;
    }
  }

  if (toolName === 'write' && typeof displayInput === 'object') {

    const content = getString('content');
    if (content) {
      return content;
    }
  }

  if (typeof displayInput === 'object') {
    const entries = Object.entries(displayInput)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => {

        const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')
          .toLowerCase()
          .replace(/^./, str => str.toUpperCase());

        let formattedValue = value;
        if (typeof value === 'object') {
          formattedValue = JSON.stringify(value, null, 2);
        } else if (typeof value === 'boolean') {
          formattedValue = value ? 'Yes' : 'No';
        }

        return `${formattedKey}: ${formattedValue}`;
      });

    return entries.join('\n');
  }

  return String(input);
}
