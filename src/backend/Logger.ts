import * as fs from 'node:fs';
import * as path from 'node:path';
import * as util from 'node:util';
import {Config} from '../common/config/private/Config';
import {LogLevel} from '../common/config/private/PrivateConfig';
import {ErrorCodes} from '../common/entities/Error';
import {ProjectPath} from './ProjectPath';
import {SafePath} from './model/fileaccess/SafePath';


const forcedDebug = process.env['NODE_ENV'] === 'debug';

if (forcedDebug === true) {
  console.log(
    'NODE_ENV environmental variable is set to debug, forcing all logs to print'
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LoggerArgs = (string | number | (() => string) | Record<any, unknown> | Error);
export type LoggerFunction = (...args: LoggerArgs[]) => void;

export interface ILogger {
  silly: LoggerFunction;
  debug: LoggerFunction;
  verbose: LoggerFunction;
  info: LoggerFunction;
  warn: LoggerFunction;
  error: LoggerFunction;
}

export const createLoggerWrapper = (TAG: string): ILogger => ({
  silly: (...args: LoggerArgs[]) => {
    Logger.silly(TAG, ...args);
  },
  debug: (...args: LoggerArgs[]) => {
    Logger.debug(TAG, ...args);
  },
  verbose: (...args: LoggerArgs[]) => {
    Logger.verbose(TAG, ...args);
  },
  info: (...args: LoggerArgs[]) => {
    Logger.info(TAG, ...args);
  },
  warn: (...args: LoggerArgs[]) => {
    Logger.warn(TAG, ...args);
  },
  error: (...args: LoggerArgs[]) => {
    Logger.error(TAG, ...args);
  }
});

export class Logger {
  // the log file is renamed to .1 above this size
  public static fileSizeLimit = 10 * 1024 * 1024;
  private static logFile: { path: string, resolved: string | null, fd: number | null, size: number } | null = null;

  public static silly(...args: LoggerArgs[]): void {
    if (!forcedDebug && Config.Server.Log.level < LogLevel.silly) {
      return;
    }
    Logger.log('SILLY', '35', console.debug, ...args);
  }

  public static debug(...args: LoggerArgs[]): void {
    if (!forcedDebug && Config.Server.Log.level < LogLevel.debug) {
      return;
    }
    Logger.log('DEBUG', '34', console.debug, ...args);
  }

  public static verbose(...args: LoggerArgs[]): void {
    if (!forcedDebug && Config.Server.Log.level < LogLevel.verbose) {
      return;
    }
    Logger.log('VERBS', '36', console.debug, ...args);
  }

  public static info(...args: LoggerArgs[]): void {
    if (!forcedDebug && Config.Server.Log.level < LogLevel.info) {
      return;
    }
    Logger.log('INFO_', '32', console.log, ...args);
  }

  public static warn(...args: LoggerArgs[]): void {
    if (!forcedDebug && Config.Server.Log.level < LogLevel.warn) {
      return;
    }
    Logger.log('WARN_', '33', console.warn, ...args);
  }

  public static error(...args: LoggerArgs[]): void {
    Logger.log('ERROR', '31', console.error, ...args);
  }

  public static logLevelForError(e: ErrorCodes): LoggerFunction {
    switch (e) {
      case ErrorCodes.INPUT_ERROR:
      case ErrorCodes.NOT_AUTHENTICATED:
      case ErrorCodes.ALREADY_AUTHENTICATED:
      case ErrorCodes.NOT_AUTHORISED:
      case ErrorCodes.PERMISSION_DENIED:
      case ErrorCodes.CREDENTIAL_NOT_FOUND:
        return Logger.debug;
      case ErrorCodes.SETTINGS_ERROR:
      case ErrorCodes.TASK_ERROR:
      case ErrorCodes.JOB_ERROR:
      case ErrorCodes.THUMBNAIL_GENERATION_ERROR:
      case ErrorCodes.PHOTO_GENERATION_ERROR:
      case ErrorCodes.INTERNAL:
        return Logger.error;
      default:
        return Logger.warn;
    }
  }

  public static closeFile(): void {
    if (Logger.logFile?.fd != null) {
      fs.closeSync(Logger.logFile.fd);
    }
    Logger.logFile = null;
  }

  /**
   * Resolves Config.Server.Log.file strictly inside the configured data folder (ProjectPath.DBFolder).
   * Rejects null bytes, paths outside the data folder, and symlink escapes.
   */
  public static resolveLogFilePath(file: string): string {
    if (typeof file !== 'string' || file.trim().length === 0 || file.includes('\0')) {
      throw new Error('Invalid log file path');
    }
    const baseDir = ProjectPath.DBFolder || ProjectPath.getAbsolutePath(Config.Database.dbFolder);
    const safeBase = path.resolve(baseDir);
    const normalizedInput = file.replace(/\\/g, '/');
    let target: string;
    if (path.isAbsolute(normalizedInput)) {
      const resolvedInput = path.resolve(normalizedInput);
      const rel = path.relative(safeBase, resolvedInput);
      if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
        throw new Error(`Log file path must stay inside the data folder (${safeBase}): ${file}`);
      }
      target = SafePath.resolve(safeBase, rel);
    } else {
      target = SafePath.resolve(safeBase, normalizedInput);
    }
    if (target === safeBase) {
      throw new Error(`Log file path must point to a file inside the data folder (${safeBase}): ${file}`);
    }

    // Synchronous symlink containment check on the nearest existing ancestor (mirrors SafePath.resolveForWrite)
    if (fs.existsSync(safeBase)) {
      const realBase = fs.realpathSync(safeBase);
      let current = target;
      while (true) {
        try {
          fs.lstatSync(current);
          break;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT' || current === safeBase) {
            throw err;
          }
          current = path.dirname(current);
        }
      }
      const realExisting = fs.realpathSync(current);
      const relReal = path.relative(realBase, realExisting);
      if (relReal === '..' || relReal.startsWith('..' + path.sep) || path.isAbsolute(relReal)) {
        throw new Error(`Path traversal detected: log file symlink escapes data folder (${safeBase})`);
      }
    }

    return target;
  }

  /**
   * Appends a line to Config.Server.Log.file (if set), e.g. for Fail2Ban on hosts without journald (#519).
   * Writes are synchronous, like console output to a file or pipe.
   * If the file is outside the data folder or can't be written, it logs that once to the console and skips the file until the setting changes.
   */
  private static writeToFile(line: string): void {
    const file = Config.Server.Log.file;
    if (Logger.logFile?.path !== file) {
      Logger.closeFile();
      if (!file) {
        return;
      }
      Logger.logFile = {path: file, resolved: null, fd: null, size: 0};
      try {
        const absolute = Logger.resolveLogFilePath(file);
        fs.mkdirSync(path.dirname(absolute), {recursive: true});
        // Re-verify symlink containment after mkdirSync
        const verified = Logger.resolveLogFilePath(file);
        Logger.logFile.resolved = verified;
        Logger.logFile.fd = fs.openSync(verified, 'a');
        Logger.logFile.size = fs.fstatSync(Logger.logFile.fd).size;
      } catch (e) {
        console.error(`Can't write the log file ${file}, logging only to the console:`, e);
        return;
      }
    }
    const lf = Logger.logFile;
    if (!lf || lf.fd === null || lf.resolved === null) {
      return;
    }
    try {
      const data = Buffer.from(line + '\n', 'utf8');
      if (lf.size > 0 && lf.size + data.length > Logger.fileSizeLimit) {
        fs.closeSync(lf.fd);
        lf.fd = null;
        fs.renameSync(lf.resolved, lf.resolved + '.1');
        lf.fd = fs.openSync(lf.resolved, 'a');
        lf.size = 0;
      }
      fs.writeSync(lf.fd, data);
      lf.size += data.length;
    } catch (e) {
      console.error(`Can't write the log file ${file}, logging only to the console:`, e);
      if (lf.fd !== null) {
        fs.closeSync(lf.fd);
        lf.fd = null;
      }
    }
  }

  private static log(level: string, color: string, fn: (...data: unknown[]) => void, ...args: LoggerArgs[]): void {
    const now = new Date();
    let LOG_TAG = '';
    if (
      args.length > 0 &&
      typeof args[0] === 'string' &&
      args[0].startsWith('[') &&
      args[0].endsWith(']')
    ) {
      LOG_TAG = args[0];
      args.shift();
    }
    args.forEach((element: LoggerArgs, index: number) => {
      if (typeof element === 'function') {
        args[index] = element(); //execute function, put resulting string in the array
      }
    });
    fn(now.toLocaleString() + `[\x1b[${color}m${level}\x1b[0m]` + LOG_TAG, ...args);
    if (Config.Server.Log.file) {
      Logger.writeToFile(util.format('%s', `${now.toISOString()} [${level}]${LOG_TAG}`, ...args));
    } else if (Logger.logFile) {
      Logger.closeFile();
    }
  }
}
