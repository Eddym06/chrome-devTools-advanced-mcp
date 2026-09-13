/**
 * Chrome profile discovery, cloning and session carry-over.
 *
 * Why this exists
 * ---------------
 * Chrome refuses to expose the CDP debug port when it is started against the
 * *live* user-data directory (and it cannot even start at all while the user's
 * real Chrome is running: one process per user-data dir). The previous
 * implementation worked around that by mirroring the profile into
 * `os.tmpdir()/chrome-mcp-shadow` with robocopy/rsync on every launch. That had
 * three problems:
 *
 *   1. It lived in the temp dir, so logins made in the automated browser were
 *      thrown away by OS cleanup and never survived an MCP restart.
 *   2. It shelled out to `robocopy`/`rsync`, which may not exist and gives
 *      almost no error information when a file is locked by a running Chrome.
 *   3. It only handled the `Default` profile.
 *
 * This module implements the same idea properly:
 *
 *   - the clone lives in a stable location (`~/.chrome-mcp/profiles/<name>`),
 *     so cookies/localStorage/logins persist between MCP sessions;
 *   - copying is pure Node (no external binaries), incremental by mtime and
 *     tolerant of files that a running Chrome has locked;
 *   - any profile (Default, "Profile 1", …) can be cloned, and the clone keeps
 *     the original profile-directory name so Chrome finds it;
 *   - `Local State` (which holds the OS-crypt key the cookies are encrypted
 *     with) is copied too — without it the cloned cookies are undecryptable.
 *
 * Security notes: nothing here ever writes into the user's real Chrome
 * user-data dir except `syncCloneToReal()`, which is an explicit, opt-in call
 * and only ever touches the session files listed below.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

import { protocolLog } from './log.js';

const execAsync = promisify(exec);

export const DEFAULT_PROFILE_DIRECTORY = 'Default';

/** Holds the OS-crypt key + the profile name cache (lives in the user-data root). */
const LOCAL_STATE_FILE = 'Local State';
/** Sentinel that suppresses Chrome's first-run flow on a cloned tree. */
const FIRST_RUN_FILE = 'First Run';
const CLONE_META_FILE = '.chrome-mcp-clone.json';

/** Stale lock files make Chrome think another instance owns the clone. */
const LOCK_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

/**
 * The state that actually carries a login over to the clone. Everything else
 * (caches, GPU shaders, crash dumps) is deliberately left behind: it is large,
 * frequently locked and has zero effect on being logged in.
 */
const SESSION_FILES = [
  // Cookies — the actual session (Google's SID/HSID/SSID live here).
  'Network/Cookies',
  'Network/Cookies-journal',
  'Network/Cookies-wal',
  'Network/Cookies-shm',
  // Chrome < 96 stored cookies directly in the profile dir.
  'Cookies',
  'Cookies-journal',
  // Passwords / autofill / GAIA account data.
  'Login Data',
  'Login Data-journal',
  'Login Data For Account',
  'Login Data For Account-journal',
  'Web Data',
  'Web Data-journal',
  'Account Web Data',
  'Account Web Data-journal',
  'Affiliation Database',
  // Per-profile settings (includes the "this profile was already set up" state).
  'Preferences',
  'Secure Preferences',
];

/** Directory-shaped session state (tokens kept by web apps themselves). */
const SESSION_DIRS = ['Local Storage', 'IndexedDB'];

/** Small, nice-to-have profile state. */
const OPTIONAL_FILES = ['Bookmarks', 'Bookmarks.bak'];

/** Only copied when `includeExtensions` is requested (can be heavy). */
const EXTENSION_ENTRIES = [
  'Extensions',
  'Local Extension Settings',
  'Extension State',
  'Extension Rules',
  'Extension Scripts',
  'Extension Cookies',
  'Managed Extension Settings',
];

/** Never worth copying: big, volatile, or actively locked by Chrome. */
const SKIP_DIR_NAMES = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'ShaderCache',
  'GrShaderCache',
  'GraphiteDawnCache',
  'Safe Browsing',
  'File System',
  'Service Worker',
  'VideoDecodeStats',
  'History Provider Cache',
  'optimization_guide_hint_cache_store',
  'AutofillStrikeDatabase',
  'Crashpad',
  'BrowserMetrics',
  'component_crx_cache',
  'extensions_crx_cache',
  'segmentation_platform',
  'Sessions',
  'Media Cache',
  'blob_storage',
  'Site Characteristics Database',
  'Shared Dictionary',
  'PersistentOriginTrials',
  'BudgetDatabase',
  'Feature Engagement Tracker',
]);

/** Default ceiling for a single copied file (keeps a runaway IndexedDB bounded). */
const DEFAULT_MAX_FILE_BYTES = 128 * 1024 * 1024;
/** Default ceiling for the number of files inspected per clone/merge pass. */
const DEFAULT_MAX_FILES = 25_000;
/** `resync: 'auto'` skips the merge when the clone was refreshed this recently. */
const DEFAULT_AUTO_RESYNC_MS = 90_000;

export interface ChromeProfileInfo {
  /** Profile directory name as Chrome knows it: "Default", "Profile 1", … */
  directory: string;
  /** Display name ("Eddy", "Trabajo", …) from `Local State`. */
  name: string;
  email?: string;
  isDefault: boolean;
  /** Chrome's `profile.last_used` marker. */
  lastUsed: boolean;
  /** Does the real profile hold cookie/localStorage state at all? */
  hasSessionState: boolean;
  /** Name of the managed clone for this profile, if one exists. */
  cloneName: string | null;
  cloneExists: boolean;
  clonePath: string | null;
}

export interface CopyStats {
  copiedFiles: number;
  copiedBytes: number;
  skippedUnchanged: number;
  /** Files the OS refused to read/write (almost always: Chrome has them open). */
  lockedFiles: string[];
  /** Present in the clone, newer than the source — kept as-is. */
  keptNewerInClone: string[];
  truncated: boolean;
}

export interface CloneResult extends CopyStats {
  profileDirectory: string;
  cloneName: string;
  /** Value to pass to Chrome's `--user-data-dir`. */
  userDataDir: string;
  /** Session state found in the clone after the copy. */
  sessionState: string[];
  /** True when an existing clone was reused without a fresh copy pass. */
  reused: boolean;
  /** False when nothing was copied because the source profile had no state. */
  sourceExists: boolean;
  /** Cookie DB did NOT make it into the clone (usually: Chrome was running). */
  cookiesMissing: boolean;
  /** The cookie DB was successfully (re)read during this pass. */
  cookiesFresh: boolean;
  /** When the cookies last came over from the real profile. */
  lastCookiesSyncAt: string | null;
  /** A `chrome` process appears to be running right now. */
  chromeRunning: boolean;
  /** Actionable instruction when the session could not be carried over. */
  actionRequired: string | null;
  durationMs: number;
}

export interface CloneOptions {
  /** Profile directory to clone ("Default", "Profile 1", … or a display name). */
  profileDirectory?: string;
  /** Clone folder name; defaults to a sanitized profile directory. */
  cloneName?: string;
  /** Override the real user-data dir (mainly for tests). */
  realUserDataDir?: string;
  /** Reuse the clone root (mainly for tests). */
  cloneRoot?: string;
  /** `auto` (default) | `always` | `never`. */
  resync?: 'auto' | 'always' | 'never';
  includeExtensions?: boolean;
  includeOptional?: boolean;
  maxFileBytes?: number;
  maxFiles?: number;
  /**
   * Keep retrying the session files for this long when a running Chrome holds
   * them locked (Chrome deliberately locks the cookie DB, so the only cure is
   * closing it). Env: CHROME_MCP_PROFILE_WAIT_MS.
   */
  waitForUnlockMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Locations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The real Chrome user-data directory for this platform. Overridable with
 * CHROME_MCP_REAL_USER_DATA_DIR (portable installs, Chromium forks, tests).
 */
export function getRealUserDataDir(explicit?: string): string {
  if (explicit) return explicit;
  const fromEnv = process.env.CHROME_MCP_REAL_USER_DATA_DIR;
  if (fromEnv) return fromEnv;

  switch (os.platform()) {
    case 'win32':
      return path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'Google',
        'Chrome',
        'User Data'
      );
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
    default:
      return path.join(os.homedir(), '.config', 'google-chrome');
  }
}

/**
 * Where clones live. Persistent on purpose: a clone keeps the session you
 * established in it (logins, tokens) for the next MCP run.
 */
export function getCloneRoot(): string {
  return (
    process.env.CHROME_MCP_PROFILE_DIR || path.join(os.homedir(), '.chrome-mcp', 'profiles')
  );
}

/** Turns any user-supplied label into a safe single-segment folder name. */
export function sanitizeProfileName(input: string): string {
  const cleaned = (input || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 60);
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new Error(`Invalid profile name: "${input}"`);
  }
  return cleaned;
}

export function getClonePath(cloneName: string, cloneRoot?: string): string {
  const root = cloneRoot || getCloneRoot();
  return path.join(root, sanitizeProfileName(cloneName));
}

/** `--user-data-dir` value for a clone: the folder that mirrors a user-data root. */
export function getCloneUserDataDir(cloneName: string, cloneRoot?: string): string {
  return getClonePath(cloneName, cloneRoot);
}

export function defaultCloneName(profileDirectory: string): string {
  return sanitizeProfileName(profileDirectory);
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovery
// ─────────────────────────────────────────────────────────────────────────────

interface LocalStateShape {
  profile?: {
    info_cache?: Record<string, { name?: string; user_name?: string; gaia_name?: string }>;
    last_used?: string;
    profiles_order?: string[];
  };
}

function readLocalState(realUserDataDir: string): LocalStateShape | null {
  try {
    const raw = fs.readFileSync(path.join(realUserDataDir, LOCAL_STATE_FILE), 'utf8');
    return JSON.parse(raw) as LocalStateShape;
  } catch {
    return null;
  }
}

function hasSessionState(profileDir: string): boolean {
  return (
    fs.existsSync(path.join(profileDir, 'Network', 'Cookies')) ||
    fs.existsSync(path.join(profileDir, 'Cookies')) ||
    fs.existsSync(path.join(profileDir, 'Local Storage'))
  );
}

function profileDirectories(realUserDataDir: string): string[] {
  const found: string[] = [];
  try {
    for (const entry of fs.readdirSync(realUserDataDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name === 'Default' || /^Profile \d+$/.test(name) || name === 'Guest Profile') {
        found.push(name);
      }
    }
  } catch {
    return [];
  }
  // Default first, then Profile 1, Profile 2… in numeric order.
  return found.sort((a, b) => {
    if (a === 'Default') return -1;
    if (b === 'Default') return 1;
    const na = Number(a.replace(/\D+/g, '')) || 0;
    const nb = Number(b.replace(/\D+/g, '')) || 0;
    return na - nb;
  });
}

/** Lists the profiles of the real Chrome install, flagging which have a clone. */
export function listChromeProfiles(options: { realUserDataDir?: string; cloneRoot?: string } = {}): ChromeProfileInfo[] {
  const realUserDataDir = getRealUserDataDir(options.realUserDataDir);
  const state = readLocalState(realUserDataDir);
  const infoCache = state?.profile?.info_cache ?? {};
  const lastUsed = state?.profile?.last_used;

  return profileDirectories(realUserDataDir).map((directory) => {
    const profilePath = path.join(realUserDataDir, directory);
    const info = infoCache[directory] ?? {};
    const cloneName = directory;
    const clonePath = getClonePath(cloneName, options.cloneRoot);
    const cloneExists = fs.existsSync(path.join(clonePath, directory));
    return {
      directory,
      name: info.name || directory,
      email: info.user_name || info.gaia_name,
      isDefault: directory === DEFAULT_PROFILE_DIRECTORY,
      lastUsed: directory === lastUsed,
      hasSessionState: hasSessionState(profilePath),
      cloneName,
      cloneExists,
      clonePath: cloneExists ? clonePath : null,
    };
  });
}

/**
 * Resolves user input ("Default", "Profile 1", "1", a display name, "auto")
 * to a real profile directory. `auto` prefers the profile Chrome used last
 * that actually has a session (i.e. the "main" profile).
 */
export function resolveProfileDirectory(
  input: string | undefined,
  options: { realUserDataDir?: string; cloneRoot?: string } = {}
): string {
  const profiles = listChromeProfiles(options);
  if (profiles.length === 0) return DEFAULT_PROFILE_DIRECTORY;

  const wanted = (input ?? 'auto').trim();
  if (!wanted || wanted.toLowerCase() === 'auto') {
    const loggedIn = profiles.filter((p) => p.hasSessionState);
    const preferred =
      profiles.find((p) => p.lastUsed && p.hasSessionState) ??
      loggedIn[0] ??
      profiles.find((p) => p.lastUsed) ??
      profiles[0];
    return preferred.directory;
  }

  const lower = wanted.toLowerCase();
  const byDirectory = profiles.find((p) => p.directory.toLowerCase() === lower);
  if (byDirectory) return byDirectory.directory;

  const numeric = `profile ${wanted.replace(/^profile\s*/i, '')}`.toLowerCase();
  const byNumber = profiles.find((p) => p.directory.toLowerCase() === numeric);
  if (byNumber) return byNumber.directory;

  const byName = profiles.find((p) => p.name.toLowerCase() === lower || p.email?.toLowerCase() === lower);
  if (byName) return byName.directory;

  throw new Error(
    `Unknown Chrome profile "${input}". Available: ${profiles
      .map((p) => `${p.directory}${p.email ? ` (${p.email})` : ''}`)
      .join(', ')}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy engine
// ─────────────────────────────────────────────────────────────────────────────

interface CopyContext extends CopyStats {
  strategy: 'newest' | 'overwrite';
  maxFileBytes: number;
  maxFiles: number;
  seenFiles: number;
  /**
   * Ignore the "clone copy is newer" rule for the cookie DB. Needed the first
   * time a clone is populated: launching Chrome on an empty clone makes Chrome
   * create its own (newer, empty) cookie DB, which would otherwise win over
   * the real profile's cookies.
   */
  forceCritical: boolean;
}

function newContext(
  strategy: CopyContext['strategy'],
  options: CloneOptions,
  forceCritical = false
): CopyContext {
  return {
    strategy,
    forceCritical,
    copiedFiles: 0,
    copiedBytes: 0,
    skippedUnchanged: 0,
    lockedFiles: [],
    keptNewerInClone: [],
    truncated: false,
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    seenFiles: 0,
  };
}

function isLockError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || code === 'EBADF';
}

/** Copy a single file, tolerating files a live Chrome keeps open. */
async function copyFile(
  src: string,
  dest: string,
  rel: string,
  ctx: CopyContext
): Promise<void> {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(src);
  } catch {
    return; // vanished mid-walk (Chrome rewrites these constantly)
  }
  if (!stat.isFile()) return;
  if (stat.size > ctx.maxFileBytes) {
    ctx.truncated = true;
    return;
  }

  let destStat: fs.Stats | null = null;
  try {
    destStat = await fsp.stat(dest);
  } catch {
    destStat = null;
  }

  if (destStat && destStat.size === stat.size && destStat.mtimeMs === stat.mtimeMs) {
    ctx.skippedUnchanged++;
    return;
  }
  const overrideNewer = ctx.forceCritical && isCriticalSessionFile(rel);
  if (destStat && ctx.strategy === 'newest' && !overrideNewer && destStat.mtimeMs > stat.mtimeMs) {
    ctx.keptNewerInClone.push(rel);
    return;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(src, dest);
      ctx.copiedFiles++;
      ctx.copiedBytes += stat.size;
      return;
    } catch (err) {
      if (isLockError(err) && attempt === 0) {
        await new Promise((r) => setTimeout(r, 150));
        continue;
      }
      if (isLockError(err)) {
        ctx.lockedFiles.push(`${rel} (${(err as NodeJS.ErrnoException).code})`);
      } else if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        ctx.lockedFiles.push(`${rel} (${(err as NodeJS.ErrnoException).code})`);
      }
      return;
    }
  }
}

/** Recursively merge a directory, skipping cache/volatile sub-trees. */
async function copyTree(srcDir: string, destDir: string, ctx: CopyContext, relBase = ''): Promise<void> {
  if (ctx.seenFiles >= ctx.maxFiles) {
    ctx.truncated = true;
    return;
  }
  if (SKIP_DIR_NAMES.has(path.basename(srcDir))) return;

  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(srcDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (ctx.seenFiles >= ctx.maxFiles) {
      ctx.truncated = true;
      return;
    }
    const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      await copyTree(src, dest, ctx, rel);
    } else if (entry.isFile()) {
      ctx.seenFiles++;
      await copyFile(src, dest, rel, ctx);
    }
  }
}

function removeLockFiles(...dirs: string[]): string[] {
  const removed: string[] = [];
  for (const dir of dirs) {
    for (const lock of LOCK_FILES) {
      const p = path.join(dir, lock);
      try {
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
          removed.push(p);
        }
      } catch {
        /* non-fatal: Chrome may still hold it */
      }
    }
  }
  return removed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cloning
// ─────────────────────────────────────────────────────────────────────────────

interface CloneMeta {
  profileDirectory: string;
  sourceUserDataDir: string;
  lastSyncAt: string;
  /** When the cookie DB last came over successfully (null = never). */
  cookiesCopiedAt?: string | null;
  includeExtensions: boolean;
}

function readCloneMeta(clonePath: string): CloneMeta | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(clonePath, CLONE_META_FILE), 'utf8')) as CloneMeta;
  } catch {
    return null;
  }
}

function writeCloneMeta(clonePath: string, meta: CloneMeta): void {
  try {
    fs.writeFileSync(path.join(clonePath, CLONE_META_FILE), JSON.stringify(meta, null, 2));
  } catch {
    /* meta is an optimization only */
  }
}

/** Session state actually present inside a clone (what the login depends on). */
export function detectSessionState(userDataDir: string, profileDirectory: string): string[] {
  const profilePath = path.join(userDataDir, profileDirectory);
  const candidates = [...SESSION_FILES, ...SESSION_DIRS];
  const present: string[] = [];
  for (const rel of candidates) {
    if (fs.existsSync(path.join(profilePath, rel))) present.push(rel);
  }
  if (fs.existsSync(path.join(userDataDir, LOCAL_STATE_FILE))) present.push(LOCAL_STATE_FILE);
  return present;
}

function resolveResync(resync: CloneOptions['resync']): 'auto' | 'always' | 'never' {
  if (resync) return resync;
  const env = (process.env.CHROME_MCP_PROFILE_RESYNC || '').toLowerCase();
  if (env === 'never' || env === 'off' || env === '0') return 'never';
  if (env === 'always' || env === '1' || env === 'true') return 'always';
  return 'auto';
}

/** Locked entry for the cookie DB — the one thing that actually breaks a login. */
function isCriticalSessionFile(entry: string): boolean {
  return entry.startsWith('Network/Cookies') || entry.startsWith('Cookies');
}

/** Is a Chrome/Chromium process running right now (best effort)? */
export async function isChromeRunning(): Promise<boolean> {
  const platform = os.platform();
  try {
    if (platform === 'win32') {
      const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq chrome.exe" /NH');
      return /chrome\.exe/i.test(stdout);
    }
    const pattern = platform === 'darwin' ? 'Google Chrome' : 'chrome';
    const { stdout } = await execAsync(`pgrep -f "${pattern}"`);
    return stdout.trim().length > 0;
  } catch {
    return false; // pgrep exits 1 when nothing matches, tasklist can be blocked
  }
}

/** Copies `Local State` (key material) + the session entries into the clone. */
async function mergeProfileIntoClone(
  sourceProfile: string,
  clonePath: string,
  profileDirectory: string,
  ctx: CopyContext,
  opts: { includeOptional: boolean; includeExtensions: boolean; realUserDataDir: string }
): Promise<void> {
  const destProfile = path.join(clonePath, profileDirectory);

  // `Local State` must come first: it carries the OS-crypt key that makes the
  // copied cookies decryptable. Its absence is the #1 cause of "the clone is
  // logged out even though Cookies was copied".
  const localStateSrc = path.join(opts.realUserDataDir, LOCAL_STATE_FILE);
  const localStateDest = path.join(clonePath, LOCAL_STATE_FILE);
  try {
    if (fs.existsSync(localStateSrc)) {
      await fsp.mkdir(path.dirname(localStateDest), { recursive: true });
      await fsp.copyFile(localStateSrc, localStateDest);
    }
  } catch (err) {
    ctx.lockedFiles.push(`${LOCAL_STATE_FILE} (${(err as NodeJS.ErrnoException).code})`);
  }

  for (const rel of SESSION_FILES) {
    await copyFile(path.join(sourceProfile, rel), path.join(destProfile, rel), rel, ctx);
  }
  for (const rel of SESSION_DIRS) {
    const src = path.join(sourceProfile, rel);
    if (fs.existsSync(src)) {
      await copyTree(src, path.join(destProfile, rel), ctx, rel);
    }
  }
  if (opts.includeOptional) {
    for (const rel of OPTIONAL_FILES) {
      await copyFile(path.join(sourceProfile, rel), path.join(destProfile, rel), rel, ctx);
    }
  }
  if (opts.includeExtensions) {
    for (const rel of EXTENSION_ENTRIES) {
      const src = path.join(sourceProfile, rel);
      if (!fs.existsSync(src)) continue;
      if (fs.statSync(src).isDirectory()) {
        await copyTree(src, path.join(destProfile, rel), ctx, rel);
      } else {
        await copyFile(src, path.join(destProfile, rel), rel, ctx);
      }
    }
  }
}

/**
 * Creates or refreshes the persistent clone of a real Chrome profile.
 *
 * The merge is *incremental and non-destructive*: files the clone already has
 * are kept when the clone's copy is newer (logins made inside the automated
 * browser survive), and nothing in the clone is ever deleted. That is what
 * makes the session last between MCP runs.
 */
export async function cloneChromeProfile(options: CloneOptions = {}): Promise<CloneResult> {
  const startedAt = Date.now();
  const realUserDataDir = getRealUserDataDir(options.realUserDataDir);
  const profileDirectory = resolveProfileDirectory(options.profileDirectory, {
    realUserDataDir,
    cloneRoot: options.cloneRoot,
  });
  const cloneName = options.cloneName ? sanitizeProfileName(options.cloneName) : defaultCloneName(profileDirectory);
  const clonePath = getClonePath(cloneName, options.cloneRoot);
  const includeExtensions = options.includeExtensions ?? process.env.CHROME_MCP_CLONE_EXTENSIONS === '1';
  const includeOptional = options.includeOptional ?? true;
  const resync = resolveResync(options.resync);

  const sourceProfile = path.join(realUserDataDir, profileDirectory);
  const sourceExists = fs.existsSync(sourceProfile);

  if (!sourceExists) {
    throw new Error(
      `Chrome profile not found: ${sourceProfile}. Is Chrome installed with a "${profileDirectory}" profile?`
    );
  }

  await fsp.mkdir(path.join(clonePath, profileDirectory), { recursive: true });

  const meta = readCloneMeta(clonePath);
  const recentlySynced =
    meta !== null && Date.now() - Date.parse(meta.lastSyncAt || '') < DEFAULT_AUTO_RESYNC_MS;
  const shouldMerge =
    resync === 'always' || (resync === 'auto' && !recentlySynced) || !fs.existsSync(path.join(clonePath, LOCAL_STATE_FILE));

  let ctx = newContext('newest', options);
  let criticalLocked: string[] = [];
  // No cookie DB has ever come from the real profile into this clone → the
  // cookie files must win over whatever Chrome created inside the clone.
  const forceCritical = meta?.cookiesCopiedAt == null;

  if (shouldMerge) {
    const waitMs = Math.max(
      0,
      options.waitForUnlockMs ?? (Number(process.env.CHROME_MCP_PROFILE_WAIT_MS || 0) || 0)
    );
    const deadline = Date.now() + waitMs;

    // Chrome deliberately takes an exclusive lock on the cookie DB, so a
    // running Chrome is the one thing that blocks the session carry-over.
    // Retry the session files until the deadline instead of failing outright.
    for (;;) {
      ctx = newContext('newest', options, forceCritical);
      await mergeProfileIntoClone(sourceProfile, clonePath, profileDirectory, ctx, {
        includeOptional,
        includeExtensions,
        realUserDataDir,
      });

      const lockedThisPass = ctx.lockedFiles.filter(isCriticalSessionFile);
      if (lockedThisPass.length === 0 || Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, 2000));
    }

    criticalLocked = ctx.lockedFiles.filter(isCriticalSessionFile);
    const sourceHasCookies =
      fs.existsSync(path.join(sourceProfile, 'Network', 'Cookies')) || fs.existsSync(path.join(sourceProfile, 'Cookies'));

    writeCloneMeta(clonePath, {
      profileDirectory,
      sourceUserDataDir: realUserDataDir,
      lastSyncAt: new Date().toISOString(),
      // Only claim a fresh cookie sync when the DB was actually readable.
      cookiesCopiedAt:
        criticalLocked.length === 0 && sourceHasCookies
          ? new Date().toISOString()
          : meta?.cookiesCopiedAt ?? null,
      includeExtensions,
    });

    protocolLog('debug', 'chrome-profiles', {
      event: 'clone-merged',
      cloneName,
      profileDirectory,
      copiedFiles: ctx.copiedFiles,
      copiedBytes: ctx.copiedBytes,
      lockedFiles: ctx.lockedFiles.length,
      durationMs: Date.now() - startedAt,
    });
  }

  // A killed previous session leaves lock files behind and Chrome then exits
  // immediately with code 0 ("another instance is using this profile").
  const removedLocks = removeLockFiles(clonePath, path.join(clonePath, profileDirectory));
  if (removedLocks.length > 0) {
    protocolLog('debug', 'chrome-profiles', { event: 'stale-locks-removed', count: removedLocks.length });
  }

  // Suppress the first-run/welcome flow on the cloned tree.
  try {
    const firstRun = path.join(clonePath, FIRST_RUN_FILE);
    if (!fs.existsSync(firstRun)) fs.writeFileSync(firstRun, '');
  } catch {
    /* non-fatal */
  }

  const sessionState = detectSessionState(clonePath, profileDirectory);
  const hasCookieDb = sessionState.some((rel) => rel === 'Network/Cookies' || rel === 'Cookies');
  const lastCookiesSyncAt = readCloneMeta(clonePath)?.cookiesCopiedAt ?? null;
  // "Fresh" = the cookie DB was actually readable *during this pass*. Chrome
  // holds an exclusive lock on it while it runs, and Chrome also creates an
  // empty cookie DB when we launch a clone that never received the real one,
  // so mere existence (`hasCookieDb`) is not enough.
  const cookiesMissing = !hasCookieDb;
  const cookiesFresh = shouldMerge
    ? criticalLocked.length === 0 && hasCookieDb
    : hasCookieDb && lastCookiesSyncAt !== null;
  const chromeRunning = criticalLocked.length > 0 ? true : !cookiesFresh ? await isChromeRunning() : false;

  let actionRequired: string | null = null;
  if (criticalLocked.length > 0) {
    actionRequired = lastCookiesSyncAt
      ? `Chrome is running, so the cookie database could not be refreshed (locked: ${criticalLocked.join(', ')}). ` +
        `The clone still has the cookies from the last successful sync (${lastCookiesSyncAt}). Close Chrome and ` +
        `re-clone for the freshest session.`
      : 'Chrome is running and it keeps an exclusive lock on its cookie database, so your session could NOT be ' +
        'copied — the clone will not be logged in. Close every Chrome window (including the background/tray ' +
        'process) and run clone_chrome_profile again: it takes about a second. Tip: pass ' +
        'waitForChromeCloseSeconds and it waits for you to close Chrome.';
  } else if (cookiesMissing) {
    actionRequired =
      'No cookie database was found for this profile. If your session lives in another Chrome profile, call ' +
      'list_chrome_profiles and clone that one instead.';
  }

  return {
    ...ctx,
    profileDirectory,
    cloneName,
    userDataDir: clonePath,
    sessionState,
    reused: !shouldMerge,
    sourceExists,
    cookiesMissing,
    cookiesFresh,
    lastCookiesSyncAt,
    chromeRunning,
    actionRequired,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Pushes session state from a clone back into the real Chrome profile, so
 * logins made in the automated browser show up in the user's own Chrome.
 * Only the session file list is touched, and only when the real Chrome is not
 * holding those files open (locked files are reported, never forced).
 */
export async function syncCloneToReal(options: {
  cloneName?: string;
  profileDirectory?: string;
  realUserDataDir?: string;
  cloneRoot?: string;
  includeExtensions?: boolean;
}): Promise<CopyStats & { cloneName: string; profileDirectory: string; wroteInto: string }> {
  const realUserDataDir = getRealUserDataDir(options.realUserDataDir);
  const cloneRoot = options.cloneRoot || getCloneRoot();
  const cloneName = sanitizeProfileName(options.cloneName || options.profileDirectory || DEFAULT_PROFILE_DIRECTORY);
  const clonePath = getClonePath(cloneName, cloneRoot);
  const meta = readCloneMeta(clonePath);
  const profileDirectory = options.profileDirectory || meta?.profileDirectory || DEFAULT_PROFILE_DIRECTORY;

  if (!fs.existsSync(path.join(clonePath, profileDirectory))) {
    throw new Error(`Clone not found: ${path.join(clonePath, profileDirectory)}. Clone the profile first.`);
  }

  const ctx = newContext('newest', {});
  const cloneProfile = path.join(clonePath, profileDirectory);
  const realProfile = path.join(realUserDataDir, profileDirectory);
  await fsp.mkdir(realProfile, { recursive: true });

  for (const rel of SESSION_FILES) {
    await copyFile(path.join(cloneProfile, rel), path.join(realProfile, rel), rel, ctx);
  }
  for (const rel of SESSION_DIRS) {
    const src = path.join(cloneProfile, rel);
    if (fs.existsSync(src)) {
      await copyTree(src, path.join(realProfile, rel), ctx, rel);
    }
  }

  protocolLog('info', 'chrome-profiles', {
    event: 'clone-synced-back',
    cloneName,
    profileDirectory,
    copiedFiles: ctx.copiedFiles,
    lockedFiles: ctx.lockedFiles.length,
  });

  return { ...ctx, cloneName, profileDirectory, wroteInto: realProfile };
}

/** Deletes a managed clone (never touches the real profile). */
export async function removeProfileClone(cloneName: string, cloneRoot?: string): Promise<string> {
  const clonePath = getClonePath(cloneName, cloneRoot);
  if (!fs.existsSync(clonePath)) {
    throw new Error(`Clone "${cloneName}" does not exist at ${clonePath}`);
  }
  await fsp.rm(clonePath, { recursive: true, force: true, maxRetries: 3 });
  return clonePath;
}

/** Human-readable status of a clone without copying anything. */
export function getCloneStatus(cloneName: string, cloneRoot?: string): {
  exists: boolean;
  path: string;
  profileDirectory: string | null;
  lastSyncAt: string | null;
  lastCookiesSyncAt: string | null;
  sessionState: string[];
} {
  const clonePath = getClonePath(cloneName, cloneRoot);
  const meta = readCloneMeta(clonePath);
  const profileDirectory = meta?.profileDirectory ?? null;
  return {
    exists: fs.existsSync(clonePath),
    path: clonePath,
    profileDirectory,
    lastSyncAt: meta?.lastSyncAt ?? null,
    lastCookiesSyncAt: meta?.cookiesCopiedAt ?? null,
    sessionState: profileDirectory ? detectSessionState(clonePath, profileDirectory) : [],
  };
}
