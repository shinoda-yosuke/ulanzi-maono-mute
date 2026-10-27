// Compiles native/micmute-helper.swift into a universal (Apple silicon + Intel) binary next to plugin/app.js.
// Needs the Xcode Command Line Tools (swiftc, lipo, codesign).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HELPER_BINARY, HELPER_SOURCE, isMain, ROOT } from './lib/paths.mjs';

// Ulanzi Studio supports macOS 10.15 and later; Apple silicon starts at macOS 11
const TARGETS = ['arm64-apple-macos11', 'x86_64-apple-macos10.15'];

/** @param {{ force?: boolean }} [options] rebuilds even when the binary is newer than the source */
export function buildHelper({ force = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('The CoreAudio helper can only be built on macOS.');
  if (!force && existsSync(HELPER_BINARY) && statSync(HELPER_BINARY).mtimeMs >= statSync(HELPER_SOURCE).mtimeMs) {
    return false;
  }

  const work = mkdtempSync(path.join(os.tmpdir(), 'micmute-helper-'));
  try {
    const slices = TARGETS.map((target) => {
      const output = path.join(work, target);
      execFileSync('xcrun', ['swiftc', '-O', '-swift-version', '5', '-target', target, HELPER_SOURCE, '-o', output], {
        stdio: 'inherit',
      });
      return output;
    });
    mkdirSync(path.dirname(HELPER_BINARY), { recursive: true });
    execFileSync('xcrun', ['lipo', '-create', ...slices, '-output', HELPER_BINARY], { stdio: 'inherit' });
    // Ad-hoc signature over the universal binary; Apple silicon refuses to run unsigned code
    execFileSync('codesign', ['--force', '--sign', '-', HELPER_BINARY], { stdio: 'inherit' });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return true;
}

if (isMain(import.meta.url)) {
  buildHelper({ force: true });
  console.log(`Built ${path.relative(ROOT, HELPER_BINARY)}`);
}
