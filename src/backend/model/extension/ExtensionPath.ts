import * as fs from 'fs';
import * as path from 'path';
import {ProjectPath} from '../../ProjectPath';
import {SafePath} from '../fileaccess/SafePath';

/** Extension code is trusted, but folder names and archive contents are not. */
export class ExtensionPath {
  public static validateName(name: string): void {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
      throw new Error('Invalid extension folder name');
    }
  }

  /** Single direct child only; never treat a symlink alias as an installed folder. */
  public static folder(name: string): string {
    ExtensionPath.validateName(name);
    const target = SafePath.resolve(ProjectPath.ExtensionFolder, name);
    try {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        throw new Error('Extension folder must not be a symbolic link');
      }
      if (!stat.isDirectory()) throw new Error('Extension folder must be a directory');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      // The root must exist, even for a new extension folder.
      fs.realpathSync(ProjectPath.ExtensionFolder);
      return target;
    }
    return SafePath.resolveExistingSync(ProjectPath.ExtensionFolder, name);
  }

  /** Optional files may be absent, but dangling/external links must fail closed. */
  public static optionalEntry(folder: string, name: string, directory = false): string | undefined {
    const target = SafePath.resolve(folder, name);
    try {
      fs.lstatSync(target);
    } catch (err) {
      if (err.code === 'ENOENT') return undefined;
      throw err;
    }
    const safe = SafePath.resolveExistingSync(folder, path.relative(folder, target));
    const stat = fs.statSync(safe);
    if (directory ? !stat.isDirectory() : !stat.isFile()) {
      throw new Error('Invalid extension entry type');
    }
    return safe;
  }
}
