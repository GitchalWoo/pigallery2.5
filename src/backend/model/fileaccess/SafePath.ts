import * as path from 'path';
import {promises as fs} from 'fs';

export class SafePath {
  /**
   * Resolves an untrusted relative or subpath against an allowed base directory.
   * Checks lexical containment only, without filesystem I/O. Use resolveExisting
   * or resolveForWrite at filesystem boundaries to check symbolic links as well.
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

    // Lexical containment check
    if (target !== safeBase && !target.startsWith(rootPrefix)) {
      throw new Error(`Path traversal detected: attempt to escape base directory`);
    }

    return target;
  }

  /**
   * Validate an existing target against the canonical root using Node's realpath.
   * Return the logical path to preserve gallery aliases and relative cache paths.
   * This is a preflight check, not protection against concurrent filesystem changes.
   */
  public static async resolveExisting(baseDir: string, untrustedPath: string): Promise<string> {
    const target = SafePath.resolve(baseDir, untrustedPath);
    const [realBase, realTarget] = await Promise.all([fs.realpath(baseDir), fs.realpath(target)]);
    SafePath.assertContained(realBase, realTarget);
    return target;
  }

  /**
   * Validate a destination that may not exist yet. The trusted root must exist.
   * Only ENOENT permits walking up to an existing ancestor; unresolved symlinks,
   * permissions errors and I/O errors fail closed. No hand-written link traversal.
   */
  public static async resolveForWrite(baseDir: string, untrustedPath: string): Promise<string> {
    const target = SafePath.resolve(baseDir, untrustedPath);
    const base = path.resolve(baseDir);
    const realBase = await fs.realpath(base);
    let current = target;
    while (true) {
      try {
        await fs.lstat(current);
        break;
      } catch (err) {
        if (err.code !== 'ENOENT' || current === base) {
          throw err;
        }
        current = path.dirname(current);
      }
    }
    // lstat sees dangling symlinks, but realpath rejects them (including chains).
    // Keep this outside the ENOENT handler: a broken link is not a new filename.
    const realExisting = await fs.realpath(current);
    SafePath.assertContained(realBase, realExisting);
    return target;
  }

  private static assertContained(base: string, target: string): void {
    const relative = path.relative(base, target);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new Error('Path traversal detected: symlink escapes base directory');
    }
  }

  /**
   * Checks lexical containment without filesystem I/O or throwing.
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
