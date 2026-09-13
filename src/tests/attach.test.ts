import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { classifyOwnerKind, parseChromeCommandLine, rankAttachTarget, type CdpOwnerInfo } from '../utils/cdp-endpoint.js';
import { attachRecipe, isProfileInUse } from '../utils/chrome-profiles.js';

describe('parseChromeCommandLine', () => {
  it('reads the flags that identify a launch', () => {
    const flags = parseChromeCommandLine(
      '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9223 ' +
        '--user-data-dir="C:\\Users\\me\\.chrome-mcp\\profiles\\Default" --profile-directory=Default --no-first-run'
    );
    expect(flags.remoteDebuggingPort).toBe(9223);
    expect(flags.userDataDir).toBe('C:\\Users\\me\\.chrome-mcp\\profiles\\Default');
    expect(flags.profileDirectory).toBe('Default');
    expect(flags.headless).toBe(false);
    expect(flags.type).toBeUndefined();
  });

  it('handles unquoted values and headless', () => {
    const flags = parseChromeCommandLine(
      'chrome --headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/clone --profile-directory=Profile 1'
    );
    expect(flags.headless).toBe(true);
    expect(flags.remoteDebuggingPort).toBe(9333);
    expect(flags.userDataDir).toBe('/tmp/clone');
    expect(flags.profileDirectory).toBe('Profile');
  });

  it('detects child processes (they are not the browser)', () => {
    const flags = parseChromeCommandLine('chrome --type=renderer --user-data-dir=C:\\x');
    expect(flags.type).toBe('renderer');
  });

  it('returns nothing for a plain launch without a debug port', () => {
    const flags = parseChromeCommandLine('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" ');
    expect(flags.remoteDebuggingPort).toBeUndefined();
    expect(flags.userDataDir).toBeUndefined();
    expect(flags.headless).toBe(false);
  });
});

describe('classifyOwnerKind', () => {
  const opts = { realUserDataDir: 'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data', cloneRoot: 'C:\\Users\\me\\.chrome-mcp\\profiles' };

  it('recognises the real profile and managed clones', () => {
    expect(classifyOwnerKind(opts.realUserDataDir, opts)).toBe('real-profile');
    expect(classifyOwnerKind('C:\\Users\\me\\.chrome-mcp\\profiles\\Default', opts)).toBe('managed-clone');
    expect(classifyOwnerKind('D:\\other\\chrome', opts)).toBe('unknown');
    expect(classifyOwnerKind(undefined, opts)).toBe('unknown');
  });

  it('is case- and separator-insensitive', () => {
    expect(classifyOwnerKind('c:/users/me/appdata/local/google/chrome/user data/', opts)).toBe('real-profile');
  });
});

describe('rankAttachTarget', () => {
  const want = {
    realUserDataDir: 'C:\\real',
    cloneRoot: 'C:\\clones',
    profileDirectory: 'Default',
    preferredPort: 9223,
  };

  const cand = (over: Partial<CdpOwnerInfo>): CdpOwnerInfo => ({ port: 9222, ok: true, kind: 'unknown', ...over });

  it('prefers the real profile with the requested profile over a clone', () => {
    const { target } = rankAttachTarget(
      [
        cand({ port: 9222, kind: 'managed-clone', profileDirectory: 'Default' }),
        cand({ port: 9333, kind: 'real-profile', profileDirectory: 'Default' }),
      ],
      want
    );
    expect(target?.port).toBe(9333);
  });

  it('prefers a matching clone over an unrelated endpoint', () => {
    const { target } = rankAttachTarget(
      [
        cand({ port: 9222, kind: 'unknown', profileDirectory: 'Default' }),
        cand({ port: 9224, kind: 'managed-clone', profileDirectory: 'Profile 2' }),
        cand({ port: 9223, kind: 'managed-clone', profileDirectory: 'Default' }),
      ],
      want
    );
    expect(target?.port).toBe(9223);
  });

  it('skips a browser whose user-data dir we do not recognise (no cross-talk between servers)', () => {
    // Another MCP server's clone on its own port: drivable, but not ours.
    const other = cand({ port: 9224, kind: 'unknown', profileDirectory: 'Default' });
    const { target, reason } = rankAttachTarget([other], want);
    expect(target).toBeNull();
    expect(reason).toMatch(/unrecognised user-data dir/);
    expect(reason).toMatch(/attach_to_running_chrome/);
  });

  it('still accepts an unrecognised browser when the caller asks for it explicitly', () => {
    const other = cand({ port: 9224, kind: 'unknown', profileDirectory: 'Default' });
    const { target } = rankAttachTarget([other], { ...want, acceptUnknownKind: true });
    expect(target?.port).toBe(9224);
  });

  it('accepts an unrecognised browser that lives on our own port', () => {
    const ours = cand({ port: 9223, kind: 'unknown', profileDirectory: 'Default' });
    const { target } = rankAttachTarget([ours], want);
    expect(target?.port).toBe(9223);
  });

  it('never picks an endpoint that is not a drivable browser', () => {
    const { target, reason } = rankAttachTarget(
      [
        { port: 9222, ok: false, kind: 'unknown', reason: 'endpoint reports itself as WebView2 (embedded browser)' },
      ],
      want
    );
    expect(target).toBeNull();
    expect(reason).toMatch(/WebView2/);
  });

  it('explains an empty scan', () => {
    const { target, reason } = rankAttachTarget([], want);
    expect(target).toBeNull();
    expect(reason).toMatch(/no CDP endpoint/);
  });
});

describe('isProfileInUse', () => {
  let workDir: string;
  let realDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-in-use-'));
    realDir = path.join(workDir, 'User Data');
    fs.mkdirSync(path.join(realDir, 'Default', 'Network'), { recursive: true });
    fs.writeFileSync(path.join(realDir, 'Default', 'Network', 'Cookies'), 'SQLite format 3x');
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('reports a readable cookie DB as not in use', () => {
    const result = isProfileInUse({ realUserDataDir: realDir, profileDirectory: 'Default' });
    expect(result.inUse).toBe(false);
    expect(result.signal).toBeNull();
  });

  it('detects the POSIX SingletonLock as a sign the profile is owned', () => {
    fs.writeFileSync(path.join(realDir, 'SingletonLock'), '');
    const result = isProfileInUse({ realUserDataDir: realDir, profileDirectory: 'Default' });
    expect(result.inUse).toBe(true);
    expect(result.signal).toMatch(/SingletonLock/);
  });

  it('ignores profiles without any cookie DB', () => {
    const result = isProfileInUse({ realUserDataDir: realDir, profileDirectory: 'Profile 9' });
    expect(result.inUse).toBe(false);
  });
});

describe('attachRecipe', () => {
  it('explains the Chrome 136 limitation and offers both ways out', () => {
    const previous = process.env.CHROME_MCP_PROFILE_DIR;
    delete process.env.CHROME_MCP_PROFILE_DIR; // the documented default location
    try {
      const recipe = attachRecipe('Default');
      expect(recipe.why).toMatch(/Chrome 136/);
      expect(recipe.options.map((o) => o.id)).toEqual(['use-the-clone', 'restart-with-port']);
      expect(recipe.options[1].steps.join(' ')).toMatch(/--remote-debugging-port=9223/);
      expect(recipe.options[0].steps.join(' ')).toMatch(/\.chrome-mcp/);
    } finally {
      if (previous !== undefined) process.env.CHROME_MCP_PROFILE_DIR = previous;
    }
  });
});
