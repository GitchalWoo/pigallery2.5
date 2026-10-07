import * as path from 'path';

export class SafePath {
  /**
   * Resolves an untrusted relative or subpath against an allowed base directory.
   * Ensures the resulting path is strictly contained within baseDir.
   * Replaces null bytes, standardizes Windows separators, and throws if the path attempts to escape baseDir.
   *
   * @param baseDir The root directory that untrustedPath must not escape
   * @param untrustedPath The user-supplied path string
   * @returns Normalized absolute path within baseDir
   */
  public static resolve(baseDir: string, untrustedPath: string): string {
    if (typeof untrustedPath !== 'string') {
      throw new Error('Path traversal detected: invalid path');
    }

    // Strip any null bytes and normalize backslashes to forward slashes for traversal detection
    const cleanPath = untrustedPath.replace(/\0/g, '').replace(/\\/g, '/');

    const safeBase = path.resolve(baseDir);
    // Treat leading '/' as relative to baseDir
    const relativePart = cleanPath.replace(/^([/])+/, '');
    const target = path.resolve(safeBase, relativePart);

    // If safeBase is root ('/'), any absolute path starts with safeBase
    const rootPrefix = safeBase === path.sep ? safeBase : safeBase + path.sep;

    if (target !== safeBase && !target.startsWith(rootPrefix)) {
      throw new Error(`Path traversal detected: attempt to escape base directory`);
    }

    return target;
  }

  /**
   * Checks whether the untrustedPath is safely contained within baseDir without throwing.
   */
  public static isSafe(baseDir: string, untrustedPath: string): boolean {
    try {
      SafePath.resolve(baseDir, untrustedPath);
      return true;
    } catch {
      return false;
    }
  }
}
