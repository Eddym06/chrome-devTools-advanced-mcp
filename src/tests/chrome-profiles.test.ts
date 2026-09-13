import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  cloneChromeProfile,
  getCloneStatus,
  hasAppBoundEncryption,
  listChromeProfiles,
  removeProfileClone,
  resolveProfileDirectory,
  sanitizeProfileName,
  syncCloneToReal,
} from '../utils/chrome-profiles.js';

let workDir: string;
let realDir: string;
let cloneRoot: string;

function write(file: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/**
 * A fake Chrome user-data dir with two profiles: "Default" (logged in) and
 * "Profile 1" (used last, also logged in) plus the cache dirs that must never
 * be copied.
 */
function makeFakeChrome(): void {
  write(
    path.join(realDir, 'Local State'),
    JSON.stringify({
      os_crypt: { encrypted_key: 'REDACTED_TEST_KEY' },
      profile: {
        last_used: 'Profile 1',
        info_cache: {
          Default: { name: 'Personal', user_name: 'personal@example.com' },
          'Profile 1': { name: 'Trabajo', user_name: 'work@example.com' },
        },
      },
    })
  );

  for (const profile of ['Default', 'Profile 1']) {
    const base = path.join(realDir, profile);
    write(path.join(base, 'Network', 'Cookies'), Buffer.from(`SQLite format 3\0${profile}-cookies`));
    write(path.join(base, 'Network', 'Cookies-journal'), 'journal');
    write(path.join(base, 'Preferences'), JSON.stringify({ profile: { name: profile } }));
    write(path.join(base, 'Local Storage', 'leveldb', '000005.ldb'), `localstorage-${profile}`);
    write(path.join(base, 'IndexedDB', 'https_example.com_0.indexeddb.leveldb', '000003.log'), 'idb');
    // Must be skipped by the clone.
    write(path.join(base, 'Cache', 'Cache_Data', 'f_000001'), Buffer.alloc(2048, 7));
    write(path.join(base, 'Service Worker', 'ScriptCache', 'x'), 'cache');
  }
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-profiles-test-'));
  realDir = path.join(workDir, 'real', 'User Data');
  cloneRoot = path.join(workDir, 'clones');
  makeFakeChrome();
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('profile discovery', () => {
  it('lists both profiles with names, emails and session state', () => {
    const profiles = listChromeProfiles({ realUserDataDir: realDir, cloneRoot });
    expect(profiles.map((p) => p.directory)).toEqual(['Default', 'Profile 1']);
    expect(profiles[0].name).toBe('Personal');
    expect(profiles[0].email).toBe('personal@example.com');
    expect(profiles.every((p) => p.hasSessionState)).toBe(true);
    expect(profiles.find((p) => p.lastUsed)?.directory).toBe('Profile 1');
    expect(profiles.every((p) => p.cloneExists === false)).toBe(true);
  });

  it('resolves "auto" to the last-used logged-in profile', () => {
    const options = { realUserDataDir: realDir, cloneRoot };
    expect(resolveProfileDirectory('auto', options)).toBe('Profile 1');
    expect(resolveProfileDirectory(undefined, options)).toBe('Profile 1');
    expect(resolveProfileDirectory('Default', options)).toBe('Default');
    expect(resolveProfileDirectory('1', options)).toBe('Profile 1');
    expect(resolveProfileDirectory('profile 1', options)).toBe('Profile 1');
    expect(resolveProfileDirectory('Trabajo', options)).toBe('Profile 1');
    expect(resolveProfileDirectory('work@example.com', options)).toBe('Profile 1');
    expect(() => resolveProfileDirectory('nope', options)).toThrow(/Unknown Chrome profile/);
  });

  it('sanitizes clone folder names and rejects traversal', () => {
    expect(sanitizeProfileName('Profile 1')).toBe('Profile_1');
    expect(sanitizeProfileName('../../etc/passwd')).toBe('etc_passwd');
    expect(() => sanitizeProfileName('..')).toThrow(/Invalid profile name/);
    expect(() => sanitizeProfileName('')).toThrow(/Invalid profile name/);
  });
});

describe('cloneChromeProfile', () => {
  it('copies the session state (cookies, localStorage, Local State) and skips caches', async () => {
    const result = await cloneChromeProfile({
      profileDirectory: 'Profile 1',
      realUserDataDir: realDir,
      cloneRoot,
    });

    const profilePath = path.join(result.userDataDir, 'Profile 1');
    expect(fs.existsSync(path.join(result.userDataDir, 'Local State'))).toBe(true);
    expect(fs.existsSync(path.join(profilePath, 'Network', 'Cookies'))).toBe(true);
    expect(fs.existsSync(path.join(profilePath, 'Local Storage', 'leveldb', '000005.ldb'))).toBe(true);
    expect(fs.existsSync(path.join(profilePath, 'IndexedDB', 'https_example.com_0.indexeddb.leveldb', '000003.log'))).toBe(true);
    // Caches and volatile trees are deliberately left behind.
    expect(fs.existsSync(path.join(profilePath, 'Cache'))).toBe(false);
    expect(fs.existsSync(path.join(profilePath, 'Service Worker'))).toBe(false);

    expect(result.profileDirectory).toBe('Profile 1');
    expect(result.cloneName).toBe('Profile_1');
    expect(result.sessionState).toContain('Network/Cookies');
    expect(result.sessionState).toContain('Local State');
    expect(result.copiedFiles).toBeGreaterThan(3);
    expect(result.lockedFiles).toEqual([]);
    expect(result.reused).toBe(false);
  });

  it('keeps a newer copy inside the clone (logins made in the automated browser survive)', async () => {
    const first = await cloneChromeProfile({ profileDirectory: 'Default', realUserDataDir: realDir, cloneRoot });
    const cloneCookies = path.join(first.userDataDir, 'Default', 'Network', 'Cookies');

    // Simulate a login inside the clone: new content + newer mtime.
    fs.writeFileSync(cloneCookies, Buffer.from('SQLite format 3\0CLONE-ONLY-COOKIES'));
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(cloneCookies, future, future);

    const second = await cloneChromeProfile({
      profileDirectory: 'Default',
      realUserDataDir: realDir,
      cloneRoot,
      resync: 'always',
    });

    expect(second.keptNewerInClone).toContain('Network/Cookies');
    expect(fs.readFileSync(cloneCookies, 'utf8')).toContain('CLONE-ONLY-COOKIES');
  });

  it('refreshes from the real profile when the clone is stale', async () => {
    const first = await cloneChromeProfile({ profileDirectory: 'Default', realUserDataDir: realDir, cloneRoot });
    const realCookies = path.join(realDir, 'Default', 'Network', 'Cookies');
    fs.writeFileSync(realCookies, Buffer.from('SQLite format 3\0REAL-NEWER-COOKIES'));
    const future = new Date(Date.now() + 120_000);
    fs.utimesSync(realCookies, future, future);

    const second = await cloneChromeProfile({
      profileDirectory: 'Default',
      realUserDataDir: realDir,
      cloneRoot,
      resync: 'always',
    });

    expect(second.copiedFiles).toBeGreaterThanOrEqual(1);
    expect(
      fs.readFileSync(path.join(first.userDataDir, 'Default', 'Network', 'Cookies'), 'utf8')
    ).toContain('REAL-NEWER-COOKIES');
  });

  it('reuses the clone untouched with resync: never', async () => {
    await cloneChromeProfile({ profileDirectory: 'Default', realUserDataDir: realDir, cloneRoot });
    const second = await cloneChromeProfile({
      profileDirectory: 'Default',
      realUserDataDir: realDir,
      cloneRoot,
      resync: 'never',
    });
    expect(second.reused).toBe(true);
    expect(second.copiedFiles).toBe(0);
  });

  it('never takes the "synced recently" shortcut while the cookies have not come over', async () => {
    const first = await cloneChromeProfile({ profileDirectory: 'Default', realUserDataDir: realDir, cloneRoot });
    const metaPath = path.join(first.userDataDir, '.chrome-mcp-clone.json');

    // Simulate the state a locked cookie DB leaves behind: a fresh sync where
    // the cookies never made it (Chrome was running).
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.cookiesCopiedAt = null;
    meta.lastSyncAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(meta));

    const second = await cloneChromeProfile({ profileDirectory: 'Default', realUserDataDir: realDir, cloneRoot, resync: 'auto' });
    expect(second.reused).toBe(false); // merge attempted again, not skipped
    expect(second.lastCookiesSyncAt).not.toBeNull();

    const third = await cloneChromeProfile({ profileDirectory: 'Default', realUserDataDir: realDir, cloneRoot, resync: 'auto' });
    expect(third.reused).toBe(true); // now the shortcut is legitimate
  });

  it('flags a clone that never captured the session when the merge is skipped', async () => {
    const first = await cloneChromeProfile({ profileDirectory: 'Default', realUserDataDir: realDir, cloneRoot });
    const metaPath = path.join(first.userDataDir, '.chrome-mcp-clone.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.cookiesCopiedAt = null;
    meta.lastSyncAt = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(meta));

    const result = await cloneChromeProfile({
      profileDirectory: 'Default',
      realUserDataDir: realDir,
      cloneRoot,
      resync: 'never',
    });
    expect(result.reused).toBe(true);
    expect(result.cookiesFresh).toBe(false);
    expect(result.actionRequired).toMatch(/never captured your real cookies/);
  });

  it('removes stale Chrome lock files from the clone (otherwise Chrome exits immediately)', async () => {
    const result = await cloneChromeProfile({ profileDirectory: 'Default', realUserDataDir: realDir, cloneRoot });
    fs.writeFileSync(path.join(result.userDataDir, 'SingletonLock'), '');
    const again = await cloneChromeProfile({
      profileDirectory: 'Default',
      realUserDataDir: realDir,
      cloneRoot,
      resync: 'never',
    });
    expect(fs.existsSync(path.join(again.userDataDir, 'SingletonLock'))).toBe(false);
  });

  it('fails with a clear error for a profile that does not exist', async () => {
    await expect(
      cloneChromeProfile({ profileDirectory: 'Profile 9', realUserDataDir: realDir, cloneRoot })
    ).rejects.toThrow(/Unknown Chrome profile/);
  });
});

describe('App-Bound Encryption detection', () => {
  it('skips encrypted state entirely and says what to do instead', async () => {
    // Seed the clone with a session "created inside the clone" first.
    const legacy = await cloneChromeProfile({ profileDirectory: 'Default', realUserDataDir: realDir, cloneRoot });
    const cloneCookies = path.join(legacy.userDataDir, 'Default', 'Network', 'Cookies');
    fs.writeFileSync(cloneCookies, Buffer.from('SQLite format 3\0CLONE-OWN-SESSION'));
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(cloneCookies, future, future);

    // Now the real profile switches to App-Bound Encryption.
    fs.writeFileSync(
      path.join(realDir, 'Local State'),
      JSON.stringify({ os_crypt: { encrypted_key: 'REDACTED_TEST_KEY', app_bound_encrypted_key: 'QUJDRA==' } })
    );
    fs.writeFileSync(path.join(realDir, 'Default', 'Network', 'Cookies'), Buffer.from('SQLite format 3\0UNREADABLE'));

    const clone = await cloneChromeProfile({
      profileDirectory: 'Default',
      realUserDataDir: realDir,
      cloneRoot,
      resync: 'always',
    });

    expect(clone.appBoundEncryption).toBe(true);
    expect(clone.cookiesUsable).toBe(false);
    expect(clone.cookiesMissing).toBe(false);
    expect(clone.actionRequired).toMatch(/App-Bound Encryption/);
    expect(clone.actionRequired).toMatch(/sign into Google inside this clone/);
    // The clone's own working session must NOT be overwritten by data Chrome
    // would discard anyway.
    expect(fs.readFileSync(cloneCookies, 'utf8')).toContain('CLONE-OWN-SESSION');
    // Local State (the key material) must not be clobbered either.
    expect(fs.readFileSync(path.join(clone.userDataDir, 'Local State'), 'utf8')).not.toContain('app_bound_encrypted_key');
  });

  it('does not flag a legacy (DPAPI-only) profile', () => {
    expect(hasAppBoundEncryption(realDir)).toBe(false);
  });

  it('merges the portable half of Local State (profile names) while keeping the clone key', async () => {
    const first = await cloneChromeProfile({ profileDirectory: 'Default', realUserDataDir: realDir, cloneRoot });
    const cloneLocalState = path.join(first.userDataDir, 'Local State');

    // The clone ends up with its OWN crypto key (as Chrome writes it).
    fs.writeFileSync(
      cloneLocalState,
      JSON.stringify({ os_crypt: { encrypted_key: 'CLONE-OWN-KEY' }, profile: { info_cache: { Default: { name: 'Your Chrome' } } } })
    );

    // Real profile now uses ABE and has the user's profile names.
    fs.writeFileSync(
      path.join(realDir, 'Local State'),
      JSON.stringify({
        os_crypt: { encrypted_key: 'REAL-KEY', app_bound_encrypted_key: 'QUJDRA==' },
        profile: { info_cache: { Default: { name: 'Eddy', user_name: 'eddym062806@gmail.com' } }, last_used: 'Default' },
        browser: { some_setting: true },
      })
    );

    await cloneChromeProfile({ profileDirectory: 'Default', realUserDataDir: realDir, cloneRoot, resync: 'always' });

    const merged = JSON.parse(fs.readFileSync(cloneLocalState, 'utf8'));
    expect(merged.os_crypt.encrypted_key).toBe('CLONE-OWN-KEY'); // never clobbered
    expect(merged.os_crypt.app_bound_encrypted_key).toBeUndefined();
    expect(merged.profile.info_cache.Default.name).toBe('Eddy'); // no more "Your Chrome"
    expect(merged.browser.some_setting).toBe(true); // other portable keys came over
  });

  it('copies browsing data (history, top sites) so the clone does not look guest-fresh', async () => {
    fs.writeFileSync(path.join(realDir, 'Default', 'History'), 'fake-history-db');
    fs.writeFileSync(path.join(realDir, 'Default', 'Top Sites'), 'fake-top-sites');
    const clone = await cloneChromeProfile({ profileDirectory: 'Default', realUserDataDir: realDir, cloneRoot });
    expect(fs.readFileSync(path.join(clone.userDataDir, 'Default', 'History'), 'utf8')).toBe('fake-history-db');
    expect(fs.readFileSync(path.join(clone.userDataDir, 'Default', 'Top Sites'), 'utf8')).toBe('fake-top-sites');
  });

  it('lets the real profile win over files Chrome recreated empty inside the clone', async () => {
    const first = await cloneChromeProfile({ profileDirectory: 'Default', realUserDataDir: realDir, cloneRoot });
    // Chrome creates an empty Bookmarks the first time the clone starts…
    fs.writeFileSync(path.join(first.userDataDir, 'Default', 'Bookmarks'), '{"roots":{}}');
    // …and it is newer than the src one, which is why mtime alone kept the empty file.
    const future = new Date(Date.now() + 120_000);
    fs.utimesSync(path.join(first.userDataDir, 'Default', 'Bookmarks'), future, future);
    fs.writeFileSync(path.join(realDir, 'Default', 'Bookmarks'), '{"roots":{"bar":[1,2,3]}}');

    const second = await cloneChromeProfile({
      profileDirectory: 'Default',
      realUserDataDir: realDir,
      cloneRoot,
      resync: 'always',
    });
    expect(fs.readFileSync(path.join(second.userDataDir, 'Default', 'Bookmarks'), 'utf8')).toContain('bar');
  });

  it('still keeps what the user changed inside the clone after the last sync', async () => {
    const first = await cloneChromeProfile({ profileDirectory: 'Default', realUserDataDir: realDir, cloneRoot, resync: 'always' });
    const clonePrefs = path.join(first.userDataDir, 'Default', 'Preferences');
    fs.writeFileSync(clonePrefs, JSON.stringify({ profile: { name: 'Cambiado en el clon' } }));
    const future = new Date(Date.now() + 180_000);
    fs.utimesSync(clonePrefs, future, future); // touched after the last sync

    const second = await cloneChromeProfile({ profileDirectory: 'Default', realUserDataDir: realDir, cloneRoot, resync: 'always' });
    expect(fs.readFileSync(path.join(second.userDataDir, 'Default', 'Preferences'), 'utf8')).toContain('Cambiado en el clon');
  });

  it('detects an unusable session in the copy stats of a legacy profile', async () => {
    const clone = await cloneChromeProfile({ profileDirectory: 'Default', realUserDataDir: realDir, cloneRoot });
    expect(clone.appBoundEncryption).toBe(false);
    expect(clone.cookiesUsable).toBe(clone.cookiesFresh);
  });
});

describe('clone status, sync-back and removal', () => {
  it('reports status with last sync time and session state', async () => {
    const result = await cloneChromeProfile({ profileDirectory: 'Default', realUserDataDir: realDir, cloneRoot });
    const status = getCloneStatus(result.cloneName, cloneRoot);
    expect(status.exists).toBe(true);
    expect(status.profileDirectory).toBe('Default');
    expect(status.sessionState).toContain('Network/Cookies');
    expect(Number.isNaN(Date.parse(status.lastSyncAt ?? ''))).toBe(false);
  });

  it('pushes the clone session into a real profile directory', async () => {
    const cloned = await cloneChromeProfile({ profileDirectory: 'Default', realUserDataDir: realDir, cloneRoot });
    fs.writeFileSync(
      path.join(cloned.userDataDir, 'Default', 'Network', 'Cookies'),
      Buffer.from('SQLite format 3\0MCP-LOGIN')
    );
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(cloned.userDataDir, 'Default', 'Network', 'Cookies'), future, future);

    const targetRoot = path.join(workDir, 'other-user-data');
    fs.mkdirSync(path.join(targetRoot, 'Default'), { recursive: true });
    const synced = await syncCloneToReal({
      cloneName: cloned.cloneName,
      profileDirectory: 'Default',
      realUserDataDir: targetRoot,
      cloneRoot,
    });

    expect(synced.copiedFiles).toBeGreaterThanOrEqual(1);
    expect(synced.wroteInto).toBe(path.join(targetRoot, 'Default'));
    expect(fs.readFileSync(path.join(targetRoot, 'Default', 'Network', 'Cookies'), 'utf8')).toContain('MCP-LOGIN');
  });

  it('removes a clone and errors on a missing one', async () => {
    const cloned = await cloneChromeProfile({ profileDirectory: 'Default', realUserDataDir: realDir, cloneRoot });
    const removed = await removeProfileClone(cloned.cloneName, cloneRoot);
    expect(fs.existsSync(removed)).toBe(false);
    await expect(removeProfileClone(cloned.cloneName, cloneRoot)).rejects.toThrow(/does not exist/);
  });
});
