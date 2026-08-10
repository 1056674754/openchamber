import { createOpencodeClient, OpencodeClient } from "@opencode-ai/sdk/v2";
import type { FilesAPI, RuntimeAPIs } from "../api/types";
import { getDesktopHomeDirectory } from "../desktop";
import type {
  Session,
  Message,
  Part,
  Provider,
  Config,
  Model,
  Agent,
  TextPartInput,
  FilePartInput,
} from "@opencode-ai/sdk/v2";
import type { PermissionRequest } from "@/types/permission";
import type { QuestionRequest } from "@/types/question";
import type { SessionMarkers, SessionMarkersPatch } from "@/stores/types/sessionMarkers";
import { waitForWorktreeBootstrap } from "@/lib/worktrees/worktreeBootstrap";
import { resolveSdkForDirectory, resolveBaseUrlForSession } from "@/sync/session-routing";
import { resolveApiUrl, resolveOpenCodeProxyApiUrl } from "@/lib/api/serverUrl";
import { buildOpenCodeHealthUrl } from "./health-url";
import { createDirectoryListError } from "./directory-list-error";
import {
  assertProviderCircuitClosed,
  recordProviderSuccess,
  recordProviderError,
} from "./provider-tracker";
import { markStartupTrace } from "@/lib/startupTrace";

// Use relative path by default (works with both dev and nginx proxy server)
// Can be overridden with VITE_OPENCODE_URL for absolute URLs in special deployments
const DEFAULT_BASE_URL = import.meta.env.VITE_OPENCODE_URL || "/api";
const CONFIG_CACHE_TTL_MS = 10_000;

function formatSdkError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;
const ID_RANDOM_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ID_RANDOM_LENGTH = 14;

let lastIdTimestamp = 0;
let idCounter = 0;

const randomBase62 = (length: number): string => {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += ID_RANDOM_CHARS[bytes[index] % ID_RANDOM_CHARS.length];
  }
  return result;
};

const ascendingId = (prefix: "msg"): string => {
  const timestamp = Date.now();
  if (timestamp !== lastIdTimestamp) {
    lastIdTimestamp = timestamp;
    idCounter = 0;
  }
  idCounter += 1;

  const sortable = BigInt(timestamp) * BigInt(0x1000) + BigInt(idCounter);
  const timeBytes = new Uint8Array(6);
  for (let index = 0; index < 6; index += 1) {
    timeBytes[index] = Number((sortable >> BigInt(40 - 8 * index)) & BigInt(0xff));
  }
  const hex = Array.from(timeBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}${randomBase62(ID_RANDOM_LENGTH)}`;
};

const readResponseTextOrEmpty = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

const ensureAbsoluteBaseUrl = (candidate: string): string => {
  const normalized = typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : "/api";

  if (ABSOLUTE_URL_PATTERN.test(normalized)) {
    return normalized;
  }

  if (typeof window === "undefined") {
    return normalized;
  }

  const baseReference = window.location?.href || window.location?.origin;
  if (!baseReference) {
    return normalized;
  }

  try {
    return new URL(normalized, baseReference).toString();
  } catch (error) {
    console.warn("Failed to normalize OpenCode base URL:", error);
    return normalized;
  }
};

const appendQueryString = (url: string, query?: Record<string, string | undefined>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      params.set(key, value);
    }
  }
  const queryString = params.toString();
  if (!queryString) {
    return url;
  }
  return `${url}${url.includes("?") ? "&" : "?"}${queryString}`;
};

const buildApiFetchUrl = (
  baseUrl: string,
  path: string,
  query?: Record<string, string | undefined>,
): string => {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return appendQueryString(resolveApiUrl(path, normalizedBase), query);
};

const buildOpenCodeProxyApiFetchUrl = (
  baseUrl: string,
  path: string,
  query?: Record<string, string | undefined>,
): string => {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return appendQueryString(resolveOpenCodeProxyApiUrl(path, normalizedBase), query);
};

const resolveDesktopBaseUrl = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const desktopServer = (window as typeof window & {
    __OPENCHAMBER_DESKTOP_SERVER__?: { origin: string; apiPrefix?: string };
    __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs;
  }).__OPENCHAMBER_DESKTOP_SERVER__;

  const isDesktop = Boolean(
    (window as typeof window & { __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs }).__OPENCHAMBER_RUNTIME_APIS__?.runtime?.isDesktop
  );

  if (!desktopServer || !isDesktop) {
    return null;
  }

  const origin = typeof desktopServer.origin === "string" && desktopServer.origin.length > 0 ? desktopServer.origin : null;
  if (!origin) {
    return null;
  }

  return `${origin}/api`;
};

interface App {
  version?: string;
  [key: string]: unknown;
}

export type FilesystemEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink?: boolean;
};

export type ProjectFileSearchHit = {
  name: string;
  path: string;
  relativePath: string;
  extension?: string;
};

type MessageWithParts = {
  info: Message;
  parts: Part[];
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const readSteerAdmission = async (response: Response, expectedMessageId: string): Promise<void> => {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    const detail = await response.text().catch(() => "");
    const excerpt = detail.trim().slice(0, 160);
    throw new Error(`invalid admission response content-type ${contentType || "unknown"}${excerpt ? `: ${excerpt}` : ""}`);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!isObjectRecord(payload) || !isObjectRecord(payload.data)) {
    throw new Error("invalid admission response payload");
  }

  const admittedId = payload.data.id;
  const delivery = payload.data.delivery;
  if (admittedId !== expectedMessageId || delivery !== "steer") {
    throw new Error(`unexpected admission response for ${expectedMessageId}`);
  }
};

type AgentPartInputLite = {
  type: 'agent';
  name: string;
  source?: {
    value: string;
    start: number;
    end: number;
  };
};

type FileInputLite = {
  id?: string;
  type: 'file';
  mime: string;
  filename?: string;
  url: string;
};

export type DirectorySwitchResult = {
  success: boolean;
  restarted: boolean;
  path: string;
  agents?: Agent[];
  providers?: Provider[];
  models?: unknown[];
};

const normalizeFsPath = (path: string): string => path.replace(/\\/g, "/");
const FS_LIST_CACHE_TTL_MS = 400;

const getDesktopFilesApi = (): FilesAPI | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const apis = (window as typeof window & { __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs }).__OPENCHAMBER_RUNTIME_APIS__;
  if (apis && apis.runtime?.isDesktop && apis.files) {
    return apis.files;
  }
  return null;
};

class OpencodeService {
  private client: OpencodeClient;
  private baseUrl: string;
  private scopedClients: Map<string, OpencodeClient> = new Map();
  private currentDirectory: string | undefined = undefined;
  private directoryContextQueue: Promise<void> = Promise.resolve();
  private listDirectoryInFlight: Map<string, Promise<FilesystemEntry[]>> = new Map();
  private listDirectoryCache: Map<string, { entries: FilesystemEntry[]; expiresAt: number }> = new Map();
  private configInFlight: Map<string, Promise<Config>> = new Map();
  private configCache: Map<string, { config: Config; expiresAt: number }> = new Map();
  private configCacheGeneration = 0;

  constructor(baseUrl: string = DEFAULT_BASE_URL) {
    const desktopBase = resolveDesktopBaseUrl();
    const requestedBaseUrl = desktopBase || baseUrl;
    this.baseUrl = ensureAbsoluteBaseUrl(requestedBaseUrl);
    this.client = createOpencodeClient({ baseUrl: this.baseUrl });
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /** Expose the raw SDK client for direct use (e.g., SyncProvider) */
  getSdkClient(): OpencodeClient {
    return this.client;
  }

  /** Get a scoped SDK client for a specific directory */
  getScopedSdkClient(directory: string): OpencodeClient {
    return this.getScopedApiClient(directory);
  }

  /**
   * Returns an SDK client scoped to a project directory.
   * Needed for worktree APIs where backend ignores per-call directory.
   */
  getScopedApiClient(directory: string): OpencodeClient {
    const normalized = this.normalizeCandidatePath(directory) ?? directory;
    const key = normalized || '';
    const existing = this.scopedClients.get(key);
    if (existing) {
      return existing;
    }
    const scoped = createOpencodeClient({ baseUrl: this.baseUrl, directory: normalized });
    this.scopedClients.set(key, scoped);
    return scoped;
  }

  private normalizeCandidatePath(path?: string | null): string | null {
    if (typeof path !== 'string') {
      return null;
    }

    const trimmed = path.trim();
    if (!trimmed) {
      return null;
    }

    // Normalize backslashes and uppercase the Windows drive letter so that
    // d:\MyProject and D:\MyProject resolve to the same canonical form.
    const normalized = trimmed
      .replace(/\\/g, '/')
      .replace(/^([a-z]):/, (_, letter: string) => letter.toUpperCase() + ':');
    const withoutTrailingSlash = normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;

    return withoutTrailingSlash || null;
  }

  private deriveHomeDirectory(path: string): { homeDirectory: string; username?: string } {
    const windowsMatch = path.match(/^([A-Za-z]:)(?:\/|$)/);
    if (windowsMatch) {
      const drive = windowsMatch[1];
      const remainder = path.slice(drive.length + (path.charAt(drive.length) === '/' ? 1 : 0));
      const segments = remainder.split('/').filter(Boolean);

      if (segments.length >= 2) {
        const homeDirectory = `${drive}/${segments[0]}/${segments[1]}`;
        return { homeDirectory, username: segments[1] };
      }

      if (segments.length === 1) {
        const homeDirectory = `${drive}/${segments[0]}`;
        return { homeDirectory, username: segments[0] };
      }

      return { homeDirectory: drive, username: undefined };
    }

    const absolute = path.startsWith('/');
    const segments = path.split('/').filter(Boolean);

    if (segments.length >= 2 && (segments[0] === 'Users' || segments[0] === 'home')) {
      const homeDirectory = `${absolute ? '/' : ''}${segments[0]}/${segments[1]}`;
      return { homeDirectory, username: segments[1] };
    }

    if (absolute) {
      if (segments.length === 0) {
        return { homeDirectory: '/', username: undefined };
      }
      const homeDirectory = `/${segments.join('/')}`;
      return { homeDirectory, username: segments[segments.length - 1] };
    }

    if (segments.length > 0) {
      const homeDirectory = `/${segments.join('/')}`;
      return { homeDirectory, username: segments[segments.length - 1] };
    }

    return { homeDirectory: '/', username: undefined };
  }

  // Set the current working directory for all API calls
  setDirectory(directory: string | undefined) {
    this.currentDirectory = this.normalizeCandidatePath(directory) ?? directory;
  }

  getDirectory(): string | undefined {
    return this.currentDirectory;
  }

  async withDirectory<T>(directory: string | undefined | null, fn: () => Promise<T>, sessionID?: string): Promise<T> {
    const runWithContext = async (): Promise<T> => {
      if (directory === undefined || directory === null) {
        return fn();
      }

      const previousDirectory = this.currentDirectory;
      const previousClient = this.client;
      this.currentDirectory = this.normalizeCandidatePath(directory) ?? directory;
      try {
        // [OPENCHAMBER-FORK] Pass sessionID for authoritative server lookup
        const remoteClient = resolveSdkForDirectory(this.currentDirectory, sessionID, undefined, this.client)
        if (remoteClient) {
          this.client = remoteClient
        }
        return await fn();
      } finally {
        this.currentDirectory = previousDirectory;
        this.client = previousClient;
      }
    };

    const queuedRun = this.directoryContextQueue.then(runWithContext, runWithContext);
    this.directoryContextQueue = queuedRun.then(
      () => undefined,
      () => undefined,
    );

    return queuedRun;
  }

  // Get the raw API client for direct access
  getApiClient(): OpencodeClient {
    return this.client;
  }

  // Get system information including home directory
  async getSystemInfo(): Promise<{ homeDirectory: string; username?: string }> {
    const candidates = new Set<string>();
    const addCandidate = (value?: string | null) => {
      const normalized = this.normalizeCandidatePath(value);
      if (normalized) {
        candidates.add(normalized);
      }
    };

    try {
      const response = await this.client.path.get(
        this.currentDirectory ? { directory: this.currentDirectory } : undefined
      );
      const info = response.data;
      if (info) {
        addCandidate(info.directory);
        addCandidate(info.worktree);
        addCandidate(info.state);
      }
    } catch (error) {
      console.debug('Failed to load path info:', error);
    }

    if (!candidates.size) {
      try {
        const project = await this.client.project.current(
          this.currentDirectory ? { directory: this.currentDirectory } : undefined
        );
        addCandidate(project.data?.worktree);
      } catch (error) {
        console.debug('Failed to load project info:', error);
      }
    }

    if (!candidates.size) {
      try {
        const sessions = await this.listSessions();
        sessions.forEach((session) => addCandidate(session.directory));
      } catch (error) {
        console.debug('Failed to inspect sessions for system info:', error);
      }
    }

    addCandidate(this.currentDirectory);

    if (typeof window !== 'undefined') {
      try {
        addCandidate(window.localStorage.getItem('lastDirectory'));
        addCandidate(window.localStorage.getItem('homeDirectory'));
      } catch {
        // Access to storage failed (e.g. privacy mode)
      }
    }

    if (!candidates.size && typeof process !== 'undefined' && typeof process.cwd === 'function') {
      addCandidate(process.cwd());
    }

    if (!candidates.size) {
      return { homeDirectory: '/', username: undefined };
    }

    const [primary] = Array.from(candidates);
    return this.deriveHomeDirectory(primary);
  }

  /**
   * Best-effort probe whether a directory is accessible to OpenCode.
   * This is intentionally NOT the same as local filesystem access in the UI runtime.
   */
  async probeDirectory(directory: string): Promise<boolean> {
    const normalized = this.normalizeCandidatePath(directory);
    if (!normalized) {
      return false;
    }
    try {
      const response = await this.client.path.get({ directory: normalized });
      const info = response.data as { directory?: unknown } | undefined;
      const returned = typeof info?.directory === 'string' ? info.directory : null;
      return Boolean(returned && returned.trim().length > 0);
    } catch {
      return false;
    }
  }

  // Session Management
  async listSessions(): Promise<Session[]> {
    const response = await this.client.session.list(
      this.currentDirectory ? { directory: this.currentDirectory } : undefined
    );
    return Array.isArray(response.data) ? response.data : [];
  }

  async createSession(params?: { parentID?: string; title?: string; metadata?: Record<string, unknown> }): Promise<Session> {
    const response = await this.client.session.create({
      ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
      parentID: params?.parentID,
      title: params?.title,
      ...(params?.metadata ? { metadata: params.metadata } : {}),
    });
    if (!response.data) throw new Error('Failed to create session');
    return response.data;
  }

  async getSession(id: string): Promise<Session> {
    const response = await this.client.session.get({
      sessionID: id,
      ...(this.currentDirectory ? { directory: this.currentDirectory } : {})
    });
    if (!response.data) throw new Error('Session not found');
    return response.data;
  }

  async deleteSession(id: string): Promise<boolean> {
    const response = await this.client.session.delete({
      sessionID: id,
      ...(this.currentDirectory ? { directory: this.currentDirectory } : {})
    });
    return response.data || false;
  }

  async updateSession(id: string, title?: string, metadata?: Record<string, unknown>): Promise<Session> {
    const response = await this.client.session.update({
      sessionID: id,
      ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
      title,
      ...(metadata ? { metadata } : {}),
    });
    if (!response.data) throw new Error('Failed to update session');
    return response.data;
  }

  async getSessionMessages(id: string, limit?: number): Promise<{ info: Message; parts: Part[] }[]> {
    const response = await this.client.session.messages({
      sessionID: id,
      ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
      ...(typeof limit === 'number' ? { limit } : {}),
    });
    return response.data || [];
  }

  async getSessionTodos(sessionId: string): Promise<Array<{ id: string; content: string; status: string; priority: string }>> {
    try {
      const base = this.baseUrl.replace(/\/$/, "");
      const url = new URL(`${base}/session/${encodeURIComponent(sessionId)}/todo`);

      if (this.currentDirectory && this.currentDirectory.length > 0) {
        url.searchParams.set("directory", this.currentDirectory);
      }

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json().catch(() => null);
      if (!data || !Array.isArray(data)) {
        return [];
      }

      return data as Array<{ id: string; content: string; status: string; priority: string }>;
    } catch {
      return [];
    }
  }

  /**
   * Check if MIME type needs normalization to text/plain.
   * Some text MIME types (like text/markdown) aren't supported by AI providers.
   */
  private shouldNormalizeToTextPlain(mime: string): boolean {
    if (!mime) return false;
    
    const lowerMime = mime.toLowerCase();
    
    // All text/* types except text/plain need normalization
    if (lowerMime.startsWith('text/') && lowerMime !== 'text/plain') {
      return true;
    }
    
    // Common application types that are actually text
    const textBasedTypes = [
      'application/json',
      'application/xml',
      'application/javascript',
      'application/typescript',
      'application/x-yaml',
      'application/yaml',
      'application/toml',
      'application/x-sh',
      'application/x-shellscript',
      'application/octet-stream',
      'image/svg+xml',
    ];
    
    return textBasedTypes.includes(lowerMime);
  }

  /**
   * Check if MIME type is HEIC/HEIF (iPhone photo format).
   */
  private isHeicMime(mime: string): boolean {
    if (!mime) return false;
    const lowerMime = mime.toLowerCase();
    return lowerMime === 'image/heic' || lowerMime === 'image/heif';
  }

  /**
   * Convert HEIC image to JPEG.
   * Returns the original file if conversion fails.
   */
  private async convertHeicToJpeg(file: { mime: string; filename?: string; url: string }): Promise<{ mime: string; filename?: string; url: string }> {
    try {
      // Dynamic import to avoid loading heic2any unless needed
      const heic2any = (await import('heic2any')).default;
      
      // Extract base64 data from data URL
      const commaIndex = file.url.indexOf(',');
      if (commaIndex === -1) return file;
      
      const base64Data = file.url.substring(commaIndex + 1);
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const heicBlob = new Blob([bytes], { type: file.mime });
      
      // Convert to JPEG
      const jpegBlob = await heic2any({
        blob: heicBlob,
        toType: 'image/jpeg',
        quality: 0.9,
      }) as Blob;
      
      // Convert back to data URL
      const jpegDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(jpegBlob);
      });
      
      // Update filename extension
      let newFilename = file.filename;
      if (newFilename) {
        newFilename = newFilename.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
      }
      
      return {
        mime: 'image/jpeg',
        filename: newFilename,
        url: jpegDataUrl
      };
    } catch (error) {
      console.warn('Failed to convert HEIC to JPEG:', error);
      return file;
    }
  }

  /**
   * Normalize file part for sending to AI providers.
   * - Converts unsupported text MIME types to text/plain
   * - Converts HEIC/HEIF images to JPEG
   */
  private async normalizeFilePart(file: { mime: string; filename?: string; url: string }): Promise<{ mime: string; filename?: string; url: string }> {
    // Handle HEIC conversion
    if (this.isHeicMime(file.mime)) {
      return this.convertHeicToJpeg(file);
    }

    // Handle text MIME normalization
    if (!this.shouldNormalizeToTextPlain(file.mime)) {
      return file;
    }

    let normalizedUrl = file.url;
    
    // Update MIME type in data URL if present
    // Format: data:<mime>;base64,<content> or data:<mime>,<content>
    if (file.url.startsWith('data:')) {
      const commaIndex = file.url.indexOf(',');
      if (commaIndex !== -1) {
        const meta = file.url.substring(5, commaIndex); // after "data:"
        const content = file.url.substring(commaIndex); // includes comma
        
        // Replace the MIME type in meta, preserving ;base64 if present
        const newMeta = meta.replace(/^[^;,]+/, 'text/plain');
        normalizedUrl = `data:${newMeta}${content}`;
      }
    }

    return {
      mime: 'text/plain',
      filename: file.filename,
      url: normalizedUrl
    };
  }

  private async toNormalizedFilePartInput(file: FileInputLite): Promise<FilePartInput> {
    const normalized = await this.normalizeFilePart(file);
    return {
      ...(file.id ? { id: file.id } : {}),
      type: 'file',
      mime: normalized.mime,
      filename: normalized.filename,
      url: normalized.url,
    };
  }

  async sendMessage(params: {
    id: string;
    providerID: string;
    modelID: string;
    text: string;
    prefaceText?: string;
    prefaceTextSynthetic?: boolean;
    agent?: string;
    variant?: string;
    files?: Array<FileInputLite>;
    /** Additional text/file parts to include (for batch sending queued messages) */
    additionalParts?: Array<{
      text: string;
      synthetic?: boolean;
      files?: Array<FileInputLite>;
    }>;
    messageId?: string;
    directory?: string | null;
    serverId?: string | null;
    agentMentions?: Array<{ name: string; source?: { value: string; start: number; end: number } }>;
    format?: {
      type: 'json_schema';
      schema: Record<string, unknown>;
      retryCount?: number;
    };
    deliveryMode?: 'normal' | 'steer';
  }): Promise<string> {
    const messageId = params.messageId ?? ascendingId("msg");

    // Build parts array using SDK types (TextPartInput | FilePartInput) plus lightweight agent parts
    const parts: Array<TextPartInput | FilePartInput | AgentPartInputLite> = [];

    if (params.prefaceText && params.prefaceText.trim()) {
      parts.push({
        type: 'text',
        text: params.prefaceText,
        synthetic: params.prefaceTextSynthetic !== false,
      });
    }

    // Add text part if there's content
    if (params.text && params.text.trim()) {
      const textPart: TextPartInput = {
        type: 'text',
        text: params.text
      };
      parts.push(textPart);
    }

    // Add file parts if provided (normalizing MIME types for compatibility)
    if (params.files && params.files.length > 0) {
      for (const file of params.files) {
        const filePart = await this.toNormalizedFilePartInput(file);
        parts.push(filePart);
      }
    }

    // Add additional parts (for batch/queued messages)
    if (params.additionalParts && params.additionalParts.length > 0) {
      for (const additional of params.additionalParts) {
        if (additional.text && additional.text.trim()) {
          parts.push({
            type: 'text',
            text: additional.text,
            ...(additional.synthetic ? { synthetic: true } : {}),
          });
        }
        if (additional.files && additional.files.length > 0) {
          for (const file of additional.files) {
            const filePart = await this.toNormalizedFilePartInput(file);
            parts.push(filePart);
          }
        }
      }
    }

    if (params.agentMentions && params.agentMentions.length > 0) {
      for (const mention of params.agentMentions) {
        if (!mention?.name) continue;
        parts.push({
          type: 'agent',
          name: mention.name,
          ...(mention.source ? { source: mention.source } : {}),
        });
      }
    }

    // Ensure we have at least one part
    if (parts.length === 0) {
      throw new Error('Message must have at least one part (text or file)');
    }

    const requestDirectory = this.normalizeCandidatePath(params.directory) ?? this.currentDirectory;

    if (requestDirectory) {
      await waitForWorktreeBootstrap(requestDirectory);
    }

    const remoteBaseUrl = resolveBaseUrlForSession(params.id, requestDirectory, params.serverId ?? undefined)
    const effectiveBase = remoteBaseUrl ?? this.baseUrl

    if (params.deliveryMode === 'steer') {
      return this.sendSteer(params, parts, messageId, requestDirectory, effectiveBase);
    }

    const url = buildApiFetchUrl(
      effectiveBase,
      `/session/${encodeURIComponent(params.id)}/prompt_async`,
      { directory: requestDirectory },
    );

    if (params.format) {
      console.info('[git-generation][browser] send structured message', {
        sessionId: params.id,
        providerID: params.providerID,
        modelID: params.modelID,
        agent: params.agent,
        variant: params.variant,
        directory: requestDirectory,
        baseUrl: this.baseUrl,
        formatType: params.format.type,
      });
    }

    assertProviderCircuitClosed(params.providerID);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          model: {
            providerID: params.providerID,
            modelID: params.modelID,
          },
          agent: params.agent,
          variant: params.variant,
          messageID: messageId,
          ...(params.format ? { format: params.format } : {}),
          parts,
        }),
      });
    } catch (error) {
      recordProviderError(params.providerID);
      throw error;
    }

    if (response.ok) {
      recordProviderSuccess(params.providerID);
      return messageId;
    }

    const detail = await readResponseTextOrEmpty(response);
    const suffix = detail && detail.trim().length > 0 ? `: ${detail.trim()}` : '';
    const error = new Error(`Failed to send message (${response.status})${suffix}`);
    Object.defineProperty(error, 'status', { value: response.status, enumerable: true });
    recordProviderError(params.providerID, response.status);
    throw error;
  }

  private async sendSteer(
    params: {
      id: string;
      providerID: string;
    },
    parts: Array<TextPartInput | FilePartInput | AgentPartInputLite>,
    messageId: string,
    requestDirectory: string | undefined,
    effectiveBase: string,
  ): Promise<string> {
    const textParts = parts.filter((p): p is TextPartInput => p.type === 'text' && !(p as { synthetic?: boolean }).synthetic);
    const fileParts = parts.filter((p): p is FilePartInput => p.type === 'file');
    const agentParts = parts.filter((p): p is AgentPartInputLite => p.type === 'agent');

    const promptBody: {
      text: string;
      files?: Array<{ type: 'file'; mime: string; url: string; filename?: string }>;
      agents?: Array<{ name: string; source?: { value: string; start: number; end: number } }>;
    } = {
      text: textParts.map((p) => p.text).join('\n'),
    };
    if (fileParts.length > 0) {
      promptBody.files = fileParts.map((f) => ({
        type: 'file' as const,
        mime: f.mime,
        url: f.url,
        ...(f.filename ? { filename: f.filename } : {}),
      }));
    }
    if (agentParts.length > 0) {
      promptBody.agents = agentParts.map((a) => ({
        name: a.name,
        ...(a.source ? { source: a.source } : {}),
      }));
    }

    const url = buildOpenCodeProxyApiFetchUrl(
      effectiveBase,
      `/api/session/${encodeURIComponent(params.id)}/prompt`,
      { directory: requestDirectory },
    );

    assertProviderCircuitClosed(params.providerID);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          id: messageId,
          prompt: promptBody,
          delivery: 'steer',
        }),
      });
    } catch (error) {
      recordProviderError(params.providerID);
      throw error;
    }

    if (response.ok) {
      try {
        await readSteerAdmission(response, messageId);
      } catch (error) {
        recordProviderError(params.providerID, response.status);
        throw new Error(`Failed to steer message: ${formatSdkError(error)}`);
      }
      recordProviderSuccess(params.providerID);
      return messageId;
    }

    const detail = await readResponseTextOrEmpty(response);
    const suffix = detail.trim() ? `: ${detail.trim()}` : '';
    const error = new Error(`Failed to steer message (${response.status})${suffix}`);
    Object.defineProperty(error, 'status', { value: response.status, enumerable: true });
    recordProviderError(params.providerID, response.status);
    throw error;
  }

  async sendCommand(params: {
    id: string;
    providerID: string;
    modelID: string;
    command: string;
    arguments?: string;
    agent?: string;
    variant?: string;
    files?: Array<FileInputLite>;
    messageId?: string;
    directory?: string | null;
    serverId?: string | null;
  }): Promise<string> {
    const tempMessageId = params.messageId ?? ascendingId("msg");

    const parts: FilePartInput[] = [];
    if (params.files && params.files.length > 0) {
      for (const file of params.files) {
        parts.push(await this.toNormalizedFilePartInput(file));
      }
    }

    const requestDirectory = this.normalizeCandidatePath(params.directory) ?? this.currentDirectory;
    const remoteBaseUrl = resolveBaseUrlForSession(params.id, requestDirectory, params.serverId ?? undefined)
    const effectiveBase = remoteBaseUrl ?? this.baseUrl
    const url = buildApiFetchUrl(
      effectiveBase,
      `/session/${encodeURIComponent(params.id)}/command`,
      { directory: requestDirectory },
    );

    const payload: Record<string, unknown> = {
      command: params.command,
      arguments: params.arguments ?? '',
      model: `${params.providerID}/${params.modelID}`,
      ...(params.agent ? { agent: params.agent } : {}),
      ...(params.variant ? { variant: params.variant } : {}),
      ...(parts.length > 0 ? { parts } : {}),
      messageID: tempMessageId,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let detail = '';
      try {
        detail = await response.text();
      } catch {
        // ignore
      }
      const suffix = detail && detail.trim().length > 0 ? `: ${detail.trim()}` : '';
      throw new Error(`Failed to run command (${response.status})${suffix}`);
    }

    return tempMessageId;
  }

  async sendShell(params: {
    id: string;
    providerID: string;
    modelID: string;
    command: string;
    agent: string;
    messageId?: string;
    directory?: string | null;
    serverId?: string | null;
  }): Promise<MessageWithParts> {
    const messageId = params.messageId ?? ascendingId("msg");
    const requestDirectory = this.normalizeCandidatePath(params.directory);

    if (!requestDirectory) {
      throw new Error(`Cannot run shell command: directory for session ${params.id} is not available`);
    }

    await waitForWorktreeBootstrap(requestDirectory);

    const remoteBaseUrl = resolveBaseUrlForSession(params.id, requestDirectory, params.serverId ?? undefined);
    const effectiveBase = remoteBaseUrl ?? this.baseUrl;
    const url = buildApiFetchUrl(
      effectiveBase,
      `/session/${encodeURIComponent(params.id)}/shell`,
      { directory: requestDirectory },
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        messageID: messageId,
        agent: params.agent,
        model: {
          providerID: params.providerID,
          modelID: params.modelID,
        },
        command: params.command,
      }),
    });

    if (!response.ok) {
      let detail = '';
      try {
        detail = await response.text();
      } catch {
        // ignore
      }
      const suffix = detail && detail.trim().length > 0 ? `: ${detail.trim()}` : '';
      throw new Error(`Failed to run shell command (${response.status})${suffix}`);
    }

    const data = await response.json().catch(() => null) as MessageWithParts | null;
    if (!data?.info?.id || !Array.isArray(data.parts)) {
      throw new Error('Failed to run shell command: invalid response');
    }

    return data;
  }

  async abortSession(id: string): Promise<boolean> {
    const response = await this.client.session.abort(
      {
        sessionID: id,
        ...(this.currentDirectory ? { directory: this.currentDirectory } : {})
      },
      { throwOnError: true }
    );
    return Boolean(response.data);
  }

  async revertSession(sessionId: string, messageId: string, partId?: string): Promise<Session> {
    const response = await this.client.session.revert({
      sessionID: sessionId,
      ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
      messageID: messageId,
      partID: partId
    });
    if (!response.data) throw new Error('Failed to revert session');
    return response.data;
  }

  async unrevertSession(sessionId: string): Promise<Session> {
    const response = await this.client.session.unrevert({
      sessionID: sessionId,
      ...(this.currentDirectory ? { directory: this.currentDirectory } : {})
    });
    if (!response.data) throw new Error('Failed to unrevert session');
    return response.data;
  }

  async forkSession(sessionId: string, messageId?: string): Promise<Session> {
    const response = await this.client.session.fork({
      sessionID: sessionId,
      ...(this.currentDirectory ? { directory: this.currentDirectory } : {}),
      messageID: messageId
    });

    if (!response.data) {
      throw new Error('Failed to fork session');
    }

    return response.data;
  }

  async getSessionStatus(): Promise<
    Record<string, { type: "idle" | "busy" | "retry"; attempt?: number; message?: string; next?: number }>
  > {
    return (await this.getSessionStatusForDirectory(this.currentDirectory ?? null)) ?? {};
  }

  async getSessionStatusForDirectory(
    directory: string | null | undefined
  ): Promise<Record<string, { type: "idle" | "busy" | "retry"; attempt?: number; message?: string; next?: number }> | null> {
    try {
      const base = this.baseUrl.replace(/\/$/, "");
      const url = new URL(`${base}/session/status`);

      const trimmedDirectory = typeof directory === "string" ? directory.trim() : "";
      if (trimmedDirectory.length > 0) {
        url.searchParams.set("directory", trimmedDirectory);
      }

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json().catch(() => null);
      if (!data || typeof data !== "object") {
        return null;
      }

      return data as Record<
        string,
        { type: "idle" | "busy" | "retry"; attempt?: number; message?: string; next?: number }
      >;
    } catch {
      return null;
    }
  }

  async getGlobalSessionStatus(): Promise<
    Record<string, { type: "idle" | "busy" | "retry"; attempt?: number; message?: string; next?: number }>
  > {
    return (await this.getSessionStatusForDirectory(null)) ?? {};
  }

  /**
   * Get session activity from web server's in-memory tracking.
   * This is more reliable than getGlobalSessionStatus on visibility restore
   * because the web server tracks activity even when UI is not listening to SSE.
   */
  async getWebServerSessionActivity(): Promise<
    Record<string, { type: string }> | null
  > {
    try {
      // Web server endpoint - use relative path that works with both dev and prod
      const response = await fetch('/api/session-activity', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json().catch(() => null);
      if (!data || typeof data !== 'object') {
        return null;
      }

      return data as Record<string, { type: string }>;
    } catch {
      return null;
    }
  }

  // Tools
  async listToolIds(options?: { directory?: string | null }): Promise<string[]> {
    try {
      const directory = typeof options?.directory === 'string'
        ? options.directory.trim()
        : (this.currentDirectory ? this.currentDirectory.trim() : '');

      const result = await this.client.tool.ids(directory ? { directory } : undefined);
      const tools = (result.data || []) as unknown as string[];
      return tools.filter((tool) => typeof tool === 'string' && tool !== 'invalid');
    } catch {
      return [];
    }
  }

  async listPendingPermissions(options?: { directories?: Array<string | null | undefined> }): Promise<PermissionRequest[]> {
    const fetches: Array<Promise<PermissionRequest[]>> = [];

    const fetchForDirectory = async (directory?: string | null): Promise<PermissionRequest[]> => {
      const trimmed = typeof directory === 'string' ? directory.trim() : '';
      const result = await this.client.permission.list(trimmed ? { directory: trimmed } : undefined);
      const rawError = (result as { error?: unknown }).error;
      if (rawError) {
        throw new Error(`permission.list failed: ${formatSdkError(rawError)}`);
      }
      return (result.data || []) as unknown as PermissionRequest[];
    };

    // Try unscoped first (server may return global pending items).
    fetches.push(fetchForDirectory(null));

    const uniqueDirectories = new Set<string>();
    for (const entry of options?.directories ?? []) {
      const normalized = this.normalizeCandidatePath(entry ?? null);
      if (normalized) {
        uniqueDirectories.add(normalized);
      }
    }

    for (const directory of uniqueDirectories) {
      fetches.push(fetchForDirectory(directory));
    }

    const results = await Promise.all(fetches);
    const merged: PermissionRequest[] = [];
    const seenIds = new Set<string>();

    for (const list of results) {
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const id = (item as { id?: unknown }).id;
        if (typeof id !== 'string' || id.length === 0) continue;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        merged.push(item);
      }
    }

    return merged;
  }

  async listPendingQuestions(options?: { directories?: Array<string | null | undefined> }): Promise<QuestionRequest[]> {
    const fetches: Array<Promise<QuestionRequest[]>> = [];

    const fetchForDirectory = async (directory?: string | null): Promise<QuestionRequest[]> => {
      const trimmed = typeof directory === 'string' ? directory.trim() : '';
      const result = await this.client.question.list(trimmed ? { directory: trimmed } : undefined);
      const rawError = (result as { error?: unknown }).error;
      if (rawError) {
        throw new Error(`question.list failed: ${formatSdkError(rawError)}`);
      }
      return (result.data || []) as unknown as QuestionRequest[];
    };

    // Try unscoped first (server may return global pending items).
    fetches.push(fetchForDirectory(null));

    const uniqueDirectories = new Set<string>();
    for (const entry of options?.directories ?? []) {
      const normalized = this.normalizeCandidatePath(entry ?? null);
      if (normalized) {
        uniqueDirectories.add(normalized);
      }
    }

    for (const directory of uniqueDirectories) {
      fetches.push(fetchForDirectory(directory));
    }

    const results = await Promise.all(fetches);
    const merged: QuestionRequest[] = [];
    const seenIds = new Set<string>();

    for (const list of results) {
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const id = (item as { id?: unknown }).id;
        if (typeof id !== 'string' || id.length === 0) continue;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        merged.push(item);
      }
    }

    return merged;
  }

  // Configuration
  clearConfigCache(): void {
    this.configCacheGeneration += 1;
    this.configInFlight.clear();
    this.configCache.clear();
  }

  /**
   * Fetch OpenCode config with instance-aware cache + in-flight dedupe.
   * Cache keys include base URL (server identity) and directory scope.
   */
  async getConfig(directory?: string | null): Promise<Config> {
    const effectiveDirectory = this.normalizeCandidatePath(directory) ?? directory ?? this.currentDirectory ?? undefined;
    const key = `${this.baseUrl}\0${effectiveDirectory ?? ''}`;
    const cached = this.configCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      markStartupTrace('opencodeClient.getConfig:cacheHit', { directory: effectiveDirectory ?? null, baseUrl: this.baseUrl });
      return cached.config;
    }

    const existing = this.configInFlight.get(key);
    if (existing) {
      markStartupTrace('opencodeClient.getConfig:deduped', { directory: effectiveDirectory ?? null, baseUrl: this.baseUrl });
      return existing;
    }

    const generation = this.configCacheGeneration;
    const request = (async () => {
      markStartupTrace('opencodeClient.getConfig:start', { directory: effectiveDirectory ?? null, baseUrl: this.baseUrl });
      const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const scopedClient = effectiveDirectory ? this.getScopedApiClient(effectiveDirectory) : this.client;
      const response = await scopedClient.config.get();
      if (!response.data) throw new Error('Failed to get config');
      const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();
      markStartupTrace('opencodeClient.getConfig:end', {
        directory: effectiveDirectory ?? null,
        baseUrl: this.baseUrl,
        durationMs: Math.round(ended - started),
      });
      if (generation === this.configCacheGeneration) {
        this.configCache.set(key, { config: response.data, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
      }
      return response.data;
    })();

    this.configInFlight.set(key, request);
    try {
      return await request;
    } finally {
      if (this.configInFlight.get(key) === request) {
        this.configInFlight.delete(key);
      }
    }
  }

  async updateConfig(config: Record<string, unknown>): Promise<Config> {
    // IMPORTANT: Do NOT pass directory parameter for config updates
    // The config should be global, not directory-specific
    const url = `${this.baseUrl}/config`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OpencodeClient] Failed to update config:', response.status, errorText);
      throw new Error(`Failed to update config: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    this.clearConfigCache();
    return data;
  }

  /**
   * Update config with a partial modification function.
   * This handles the GET-modify-PATCH pattern required by the upstream API.
   *
   * NOTE: This method is deprecated for agent configuration.
   * Use backend endpoints at /api/config/agents/* instead, which write directly to files.
   *
   * @param modifier Function that receives current config and returns modified config
   * @returns Updated config from server
   */
  async updateConfigPartial(modifier: (config: Config) => Config): Promise<Config> {
    const currentConfig = await this.getConfig();
    const updatedConfig = modifier(currentConfig);
    const result = await this.updateConfig(updatedConfig);
    return result;
  }

  async getProviders(): Promise<{
    providers: Provider[];
    default: { [key: string]: string };
  }> {
    const response = await this.client.config.providers(
      this.currentDirectory ? { directory: this.currentDirectory } : undefined
    );
    if (!response.data) throw new Error('Failed to get providers');
    return response.data;
  }

  // App Management - using config endpoint since /app doesn't exist in this version
  async getApp(): Promise<App> {
    // Return basic app info from config
    const config = await this.getConfig();
    return {
      version: "0.0.3", // from the OpenAPI spec
      config
    };
  }

  async initApp(): Promise<boolean> {
    try {
      // Just check if we can connect since there's no init endpoint
      return await this.checkHealth();
    } catch {
      return false;
    }
  }

  // Agent Management
  async listAgents(): Promise<Agent[]> {
    const response = await this.client.app.agents(
      this.currentDirectory ? { directory: this.currentDirectory } : undefined
    );
    const rawError = (response as { error?: unknown }).error;
    if (rawError) {
      throw new Error(`app.agents failed: ${formatSdkError(rawError)}`);
    }
    return response.data || [];
  }

  // SSE infrastructure removed — EventPipeline in sync/event-pipeline.ts handles
  // all SSE event ingestion via the SDK's global.event() async iterator.

  // File Operations
  async readFile(path: string): Promise<string> {
    try {
      // For now, we'll use a placeholder implementation
      // In a real implementation, this would call an API endpoint to read the file
      const response = await fetch(`${this.baseUrl}/files/read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path,
          directory: this.currentDirectory
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to read file: ${response.statusText}`);
      }

      const data = await response.text();
      return data;
    } catch {
      // Return placeholder for development
      return `// Content of ${path}\n// This would be loaded from the server`;
    }
  }

  async listFiles(directory?: string): Promise<Record<string, unknown>[]> {
    try {
      const targetDir = directory || this.currentDirectory || '/';
      let fsBaseUrl: string = this.baseUrl;
      if (targetDir) {
        for (const e of getAllSyncStores()) {
          if (e.serverId === DEFAULT_SERVER_ID) continue;
          if (e.childStores.getChild(targetDir)) {
            const conn = serverRegistry.get(e.serverId);
            if (conn) { fsBaseUrl = conn.config.baseUrl; break; }
          }
        }
      }
      const response = await fetch(`${fsBaseUrl}/files/list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ directory: targetDir })
      });

      if (!response.ok) {
        throw new Error(`Failed to list files: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch {
      // Return mock data for development
      return [];
    }
  }

  // Command Management
  async listCommands(): Promise<Array<{ name: string; description?: string; agent?: string; model?: string; source?: string }>> {
    try {
      const response = await this.client.command.list(
        this.currentDirectory ? { directory: this.currentDirectory } : undefined
      );
      // Return only lightweight info for autocomplete
      return (response.data || []).map((cmd: Record<string, unknown>) => ({
        name: cmd.name as string,
        description: cmd.description as string | undefined,
        agent: cmd.agent as string | undefined,
        model: cmd.model as string | undefined,
        source: cmd.source as string | undefined,
        // Intentionally excluding template to keep memory usage low
      }));
    } catch {
      return [];
    }
  }

  async listCommandsWithDetails(directory?: string | null): Promise<Array<{ name: string; description?: string; agent?: string; model?: string; source?: string; template?: string }>> {
    try {
      const requestDirectory = this.normalizeCandidatePath(directory ?? null) ?? this.currentDirectory;
      const response = await this.client.command.list(
        requestDirectory ? { directory: requestDirectory } : undefined
      );
      // Return full command details including template
      return (response.data || []).map((cmd: Record<string, unknown>) => ({
        name: cmd.name as string,
        description: cmd.description as string | undefined,
        agent: cmd.agent as string | undefined,
        model: cmd.model as string | undefined,
        source: cmd.source as string | undefined,
        template: cmd.template as string | undefined,
      }));
    } catch {
      return [];
    }
  }

  async listSkillsWithDetails(): Promise<Array<{ name: string; description?: string; location: string; content?: string }>> {
    try {
      const response = await this.client.app.skills(
        this.currentDirectory ? { directory: this.currentDirectory } : undefined,
      );
      const data = response.data;
      if (!Array.isArray(data)) {
        return [];
      }

      const skills: Array<{ name: string; description?: string; location: string; content?: string }> = [];
      for (const item of data as Array<Record<string, unknown>>) {
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        const location = typeof item.location === 'string' ? item.location : '';
        if (!name || !location || location === '<built-in>') {
          continue;
        }
        const skill: { name: string; description?: string; location: string; content?: string } = { name, location };
        if (typeof item.description === 'string') skill.description = item.description;
        if (typeof item.content === 'string') skill.content = item.content;
        skills.push(skill);
      }
      return skills;
    } catch {
      return [];
    }
  }

  async getCommandDetails(name: string): Promise<{ name: string; template: string; description?: string; agent?: string; model?: string } | null> {
    try {
      const response = await this.client.command.list(
        this.currentDirectory ? { directory: this.currentDirectory } : undefined
      );

      if (response.data) {
        const command = response.data.find((cmd: Record<string, unknown>) => cmd.name === name);
        if (command) {
          return {
            name: command.name as string,
            template: command.template as string,
            description: command.description as string | undefined,
            agent: command.agent as string | undefined,
            model: command.model as string | undefined
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  // Lightweight readiness check. Full diagnostics still live at /health.
  async checkHealth(): Promise<boolean> {
    try {
      const healthUrl = buildOpenCodeHealthUrl(this.baseUrl);
      const response = await fetch(healthUrl);
      if (!response.ok) {
        return false;
      }

      const healthData = await response.json();

      return healthData?.healthy === true;
    } catch {
      return false;
    }
  }

  // File System Operations
  async createDirectory(
    dirPath: string,
    options?: { allowOutsideWorkspace?: boolean; asProject?: boolean }
  ): Promise<{ success: boolean; path: string }> {
    const desktopFiles = getDesktopFilesApi();
    if (desktopFiles?.createDirectory) {
      try {
        return await desktopFiles.createDirectory(dirPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message || 'Failed to create directory');
      }
    }

    if (options?.asProject) {
      // When adding a new project, route through the project-aware directory
      // endpoint so the server creates the folder AND registers it as a
      // project in one atomic step. Multi-instance routing still applies.
      let projectBaseUrl: string = this.baseUrl;
      for (const e of getAllSyncStores()) {
        if (e.serverId === DEFAULT_SERVER_ID) continue;
        if (e.childStores.getChild(dirPath)) {
          const conn = serverRegistry.get(e.serverId);
          if (conn) { projectBaseUrl = conn.config.baseUrl; break; }
        }
      }
      const response = await fetch(`${projectBaseUrl}/opencode/directory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath, create: true }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to create project directory' }));
        throw new Error(error.error || 'Failed to create project directory');
      }
      const result = await response.json();
      return { success: true, path: result.path };
    }

    const payload = {
      path: dirPath,
      ...(options?.allowOutsideWorkspace ? { allowOutsideWorkspace: true } : {}),
    };

    let fsBaseUrl: string = this.baseUrl;
    for (const e of getAllSyncStores()) {
      if (e.serverId === DEFAULT_SERVER_ID) continue;
      if (e.childStores.getChild(dirPath)) {
        const conn = serverRegistry.get(e.serverId);
        if (conn) { fsBaseUrl = conn.config.baseUrl; break; }
      }
    }
    const response = await fetch(`${fsBaseUrl}/fs/mkdir`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to create directory' }));
      throw new Error(error.error || 'Failed to create directory');
    }

    const result = await response.json();
    return result;
  }

  async cloneRepository(input: { remoteUrl: string; destinationPath: string; gitIdentityId?: string | null }): Promise<{ success: boolean; path: string; output?: string }> {
    let fsBaseUrl: string = this.baseUrl;
    for (const e of getAllSyncStores()) {
      if (e.serverId === DEFAULT_SERVER_ID) continue;
      if (e.childStores.getChild(input.destinationPath)) {
        const conn = serverRegistry.get(e.serverId);
        if (conn) { fsBaseUrl = conn.config.baseUrl; break; }
      }
    }
    const response = await fetch(`${fsBaseUrl}/fs/clone`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to clone repository' }));
      throw new Error(error.error || 'Failed to clone repository');
    }

    return await response.json();
  }

  async listLocalDirectory(directoryPath: string | null | undefined, options?: { respectGitignore?: boolean }): Promise<FilesystemEntry[]> {
    const normalizedDirectoryPath = typeof directoryPath === 'string' ? normalizeFsPath(directoryPath.trim()) : '';
    const cacheKey = `${normalizedDirectoryPath}|${options?.respectGitignore ? '1' : '0'}`;
    const now = Date.now();
    const cached = this.listDirectoryCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.entries;
    }

    const inFlight = this.listDirectoryInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const task = (async () => {
      const desktopFiles = getDesktopFilesApi();
      if (desktopFiles) {
        try {
          const result = await desktopFiles.listDirectory(directoryPath || '', options);
          if (!result || !Array.isArray(result.entries)) {
            return [];
          }
          const entries = result.entries.map<FilesystemEntry>((entry) => ({
            name: entry.name,
            path: normalizeFsPath(entry.path),
            isDirectory: !!entry.isDirectory,
            isFile: !entry.isDirectory,
            isSymbolicLink: false,
          }));
          this.listDirectoryCache.set(cacheKey, {
            entries,
            expiresAt: Date.now() + FS_LIST_CACHE_TTL_MS,
          });
          return entries;
        } catch (error) {
          throw createDirectoryListError(error, normalizedDirectoryPath);
        }
      }

      try {
        const params = new URLSearchParams();
        if (directoryPath && directoryPath.trim().length > 0) {
          params.set('path', directoryPath);
        }
        if (options?.respectGitignore) {
          params.set('respectGitignore', 'true');
        }
        const query = params.toString();
        // [OPENCHAMBER-FORK] 2025-05-18 v1.11.1-dev-merge
        // Resolve baseUrl by checking remote SyncProviders at runtime — no path matching.
        let fsBaseUrl: string = this.baseUrl;
        if (directoryPath) {
          for (const e of getAllSyncStores()) {
            if (e.serverId === DEFAULT_SERVER_ID) continue;
            if (e.childStores.getChild(directoryPath)) {
              const conn = serverRegistry.get(e.serverId);
              if (conn) { fsBaseUrl = conn.config.baseUrl; break; }
            }
          }
        }
        const response = await fetch(`${fsBaseUrl}/fs/list${query ? `?${query}` : ''}`);
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          const message = typeof error.error === 'string' ? error.error : 'Failed to list directory';
          throw new Error(`${message} (HTTP ${response.status})`);
        }

        const result = await response.json();
        if (!result || !Array.isArray(result.entries)) {
          return [];
        }

        const entries = result.entries as FilesystemEntry[];
        this.listDirectoryCache.set(cacheKey, {
          entries,
          expiresAt: Date.now() + FS_LIST_CACHE_TTL_MS,
        });
        return entries;
      } catch (error) {
        throw createDirectoryListError(error, normalizedDirectoryPath);
      }
    })();

    const trackedTask = task.finally(() => {
      if (this.listDirectoryInFlight.get(cacheKey) === trackedTask) {
        this.listDirectoryInFlight.delete(cacheKey);
      }
    });
    this.listDirectoryInFlight.set(cacheKey, trackedTask);
    return trackedTask;
  }

  async searchFiles(
    query: string,
    options?: {
      directory?: string | null;
      limit?: number;
      includeHidden?: boolean;
      respectGitignore?: boolean;
      dirs?: boolean;
      type?: 'file' | 'directory';
    }
  ): Promise<ProjectFileSearchHit[]> {
    const directory = typeof options?.directory === 'string' && options.directory.trim().length > 0
      ? options.directory.trim()
      : this.currentDirectory;
    const normalizedDirectory = directory ? normalizeFsPath(directory) : null;
    const scopedClient = directory ? this.getScopedApiClient(directory) : this.client;

    try {
      const response = await scopedClient.find.files({
        query,
        limit: typeof options?.limit === 'number' && Number.isFinite(options.limit) ? options.limit : undefined,
        dirs: options?.dirs === false || options?.type === 'file' ? 'false' : 'true',
        type: options?.type,
      });

      const items = Array.isArray(response?.data) ? response.data : [];
      return items.map<ProjectFileSearchHit>((item) => {
        const normalizedRelativePath = normalizeFsPath(item);
        const name = normalizedRelativePath.split('/').filter(Boolean).pop() || normalizedRelativePath;
        const normalizedPath = normalizedDirectory
          ? normalizeFsPath(`${normalizedDirectory}/${normalizedRelativePath}`)
          : normalizeFsPath(normalizedRelativePath);

        return {
          name,
          path: normalizedPath,
          relativePath: normalizedRelativePath,
          extension: name.includes('.') ? name.split('.').pop()?.toLowerCase() : undefined,
        };
      });
    } catch (error) {
      console.error('Failed to search files:', error);
      throw error;
    }
  }

  async getFilesystemHome(): Promise<string | null> {
    // Optimization: Check for desktop runtime first to avoid unnecessary network calls
    // and fix the "SyntaxError" warning when the endpoint is missing
    const desktopHome = await getDesktopHomeDirectory();
    if (desktopHome) {
      return desktopHome;
    }

    try {
      const response = await fetch(`${this.baseUrl}/fs/home`, {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const message =
          typeof error.error === 'string' && error.error.length > 0
            ? error.error
            : 'Failed to resolve home directory';
        throw new Error(message);
      }

      const payload = await response.json();
      if (payload && typeof payload.home === 'string' && payload.home.length > 0) {
        return payload.home;
      }
      return null;
    } catch (error) {
      console.warn('Failed to resolve filesystem home directory:', error);
      return null;
    }
  }

  async setOpenCodeWorkingDirectory(directoryPath: string | null | undefined): Promise<DirectorySwitchResult | null> {
    if (!directoryPath || typeof directoryPath !== 'string' || !directoryPath.trim()) {
      console.warn('[OpencodeClient] setOpenCodeWorkingDirectory: invalid path', directoryPath);
      return null;
    }

    const url = `${this.baseUrl}/opencode/directory`;
    console.log('[OpencodeClient] POST', url, 'with path:', directoryPath);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path: directoryPath })
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const error = payload ?? {};
        const message =
          typeof error.error === 'string' && error.error.length > 0
            ? error.error
            : 'Failed to update OpenCode working directory';
        throw new Error(message);
      }

      if (payload && typeof payload === 'object') {
        return payload as DirectorySwitchResult;
      }

      return {
        success: true,
        restarted: false,
        path: directoryPath
      };
    } catch (error) {
      console.warn('Failed to update OpenCode working directory:', error);
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Session markers — per-session user-defined status, todos, priority.
  // Routes: GET/PUT/DELETE /api/openchamber/sessions/.../markers
  // -------------------------------------------------------------------------

  /**
   * Fetch all session markers (bulk, for bootstrap hydration).
   * Route: GET /api/openchamber/sessions/markers
   */
  async getSessionMarkers(): Promise<{ version: number; sessions: Record<string, SessionMarkers> }> {
    const response = await fetch('/api/openchamber/sessions/markers', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`getSessionMarkers failed: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as { version?: unknown; sessions?: unknown };
    const version = typeof data.version === 'number' ? data.version : 0;
    const sessions = data.sessions && typeof data.sessions === 'object'
      ? data.sessions as Record<string, SessionMarkers>
      : {};
    return { version, sessions };
  }

  /**
   * Partially update markers for a single session.
   * Route: PUT /api/openchamber/sessions/:sessionId/markers
   */
  async setSessionMarkers(
    sessionId: string,
    patch: SessionMarkersPatch,
  ): Promise<{ sessionId: string; markers: SessionMarkers }> {
    const response = await fetch(
      `/api/openchamber/sessions/${encodeURIComponent(sessionId)}/markers`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(patch),
      },
    );
    if (!response.ok) {
      throw new Error(`setSessionMarkers failed: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as { sessionId?: unknown; markers?: unknown };
    const resultSessionId = typeof data.sessionId === 'string' ? data.sessionId : sessionId;
    const markers = (data.markers ?? { todos: [] }) as SessionMarkers;
    return { sessionId: resultSessionId, markers };
  }

  /**
   * Clear all markers for a session.
   * Route: DELETE /api/openchamber/sessions/:sessionId/markers
   */
  async clearSessionMarkers(
    sessionId: string,
  ): Promise<{ sessionId: string; cleared: boolean }> {
    const response = await fetch(
      `/api/openchamber/sessions/${encodeURIComponent(sessionId)}/markers`,
      { method: 'DELETE', headers: { accept: 'application/json' } },
    );
    if (!response.ok) {
      throw new Error(`clearSessionMarkers failed: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as { sessionId?: unknown; cleared?: unknown };
    const resultSessionId = typeof data.sessionId === 'string' ? data.sessionId : sessionId;
    const cleared = typeof data.cleared === 'boolean' ? data.cleared : true;
    return { sessionId: resultSessionId, cleared };
  }
}

// Exported singleton instance
export const opencodeClient = new OpencodeService();

import { serverRegistry, DEFAULT_SERVER_ID } from "./server-registry";
import { getAllSyncStores } from "@/sync/multi-server-registry";
serverRegistry.register({
  id: DEFAULT_SERVER_ID,
  label: "Local",
  baseUrl: opencodeClient.getBaseUrl(),
});
serverRegistry.startHealthPolling(30_000);

// HMR self-accept boundary: prevents re-eval of this singleton from
// invalidating the ~35 consumer modules whose `opencodeClient` import binding
// would otherwise enter TDZ and crash concurrent renders. Caveat: edits to
// OpencodeService methods need a full reload to reach consumers.
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    serverRegistry.stopHealthPolling();
  });
}

// Exported types
export type { Session, Message, Part, Provider, Config, Model };
export type { App };
