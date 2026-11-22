import {expect} from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {Logger} from '../../../src/backend/Logger';
import {ProjectPath} from '../../../src/backend/ProjectPath';
import {Config} from '../../../src/common/config/private/Config';
import {LogLevel} from '../../../src/common/config/private/PrivateConfig';
import {TestHelper} from '../../TestHelper';

declare const describe: any;
declare const it: any;
declare const beforeEach: any;
declare const afterEach: any;

describe('Logger', () => {
  const dir = path.join(TestHelper.TMP_DIR, 'logger');
  const outsideDir = path.join(TestHelper.TMP_DIR, 'logger-outside');
  const relLogFile = path.join('logs', 'pigallery2.log');
  const logFile = path.join(dir, relLogFile);
  const origConsole = {log: console.log, warn: console.warn, error: console.error, debug: console.debug};
  const origLimit = Logger.fileSizeLimit;
  const origDBFolder = ProjectPath.DBFolder;
  const origLogLevel = Config.Server.Log.level;

  beforeEach(() => {
    fs.rmSync(dir, {recursive: true, force: true});
    fs.rmSync(outsideDir, {recursive: true, force: true});
    fs.mkdirSync(dir, {recursive: true});
    ProjectPath.DBFolder = dir;
    // keep the test output clean
    console.log = console.warn = console.error = console.debug = (): void => undefined;
    Config.Server.Log.level = LogLevel.info;
    Config.Server.Log.file = '';
    Logger.closeFile();
  });

  afterEach(() => {
    Object.assign(console, origConsole);
    Config.Server.Log.file = '';
    Config.Server.Log.level = origLogLevel;
    Logger.fileSizeLimit = origLimit;
    Logger.closeFile();
    ProjectPath.DBFolder = origDBFolder;
    fs.rmSync(dir, {recursive: true, force: true});
    fs.rmSync(outsideDir, {recursive: true, force: true});
  });

  const readLines = (file = logFile): string[] =>
    fs.readFileSync(file, 'utf8').split('\n').filter(l => l !== '');

  it('should not write a file by default', () => {
    Logger.warn('AuthenticationMWs', 'Failed login');
    expect(Config.Server.Log.file).to.equal('');
    expect(fs.existsSync(logFile)).to.be.false;
  });

  it('should write plain lines with an ISO timestamp to the file, creating its folder', () => {
    Config.Server.Log.file = relLogFile;
    Logger.warn('AuthenticationMWs', 'Failed login from IP `203.0.113.7` for user:"bob"', {a: 1});
    Logger.info('[Job]', 'started');

    const lines = readLines();
    expect(lines).to.have.length(2);
    expect(lines[0]).to.match(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z \[WARN_] AuthenticationMWs Failed login from IP `203\.0\.113\.7` for user:"bob" \{ a: 1 }$/);
    expect(lines[1]).to.match(/Z \[INFO_]\[Job] started$/);
    expect(fs.readFileSync(logFile, 'utf8')).to.not.include('\x1b');
  });

  it('should accept an absolute path inside the data folder', () => {
    Config.Server.Log.file = logFile;
    Logger.warn('inside-abs');
    const lines = readLines();
    expect(lines).to.have.length(1);
    expect(lines[0]).to.include('inside-abs');
  });

  it('should follow the log level', () => {
    Config.Server.Log.file = relLogFile;
    Logger.debug('not written');
    Logger.error('written');
    const lines = readLines();
    expect(lines).to.have.length(1);
    expect(lines[0]).to.include('[ERROR] written');
  });

  it('should keep one old file when the file gets too big', () => {
    Config.Server.Log.file = relLogFile;
    Logger.fileSizeLimit = 100;
    Logger.warn('first', 'x'.repeat(80));
    Logger.warn('second', 'x'.repeat(80));
    Logger.warn('third');

    expect(readLines(logFile + '.1')).to.have.length(1);
    expect(readLines(logFile + '.1')[0]).to.include('second');
    expect(readLines()).to.have.length(1);
    expect(readLines()[0]).to.include('third');
  });

  it('should switch to a new file when the setting changes', () => {
    Config.Server.Log.file = relLogFile;
    Logger.warn('one');
    const otherRel = 'other.log';
    const otherAbs = path.join(dir, otherRel);
    Config.Server.Log.file = otherRel;
    Logger.warn('two');

    expect(readLines()).to.have.length(1);
    expect(readLines(otherAbs)).to.have.length(1);
    expect(readLines(otherAbs)[0]).to.include('two');
  });

  it('should keep logging to the console if the file cannot be written', () => {
    let printed = 0;
    console.warn = (): void => {
      printed++;
    };
    fs.mkdirSync(logFile, {recursive: true}); // a folder at the file's path
    Config.Server.Log.file = relLogFile;
    Logger.warn('one');
    Logger.warn('two');
    expect(printed).to.equal(2);
  });

  it('should reject traversal paths outside the data folder and keep logging to the console', () => {
    let printed = 0;
    let errors = 0;
    console.warn = (): void => {
      printed++;
    };
    console.error = (): void => {
      errors++;
    };
    const escapedPath = path.join(outsideDir, 'escaped.log');
    Config.Server.Log.file = '../logger-outside/escaped.log';
    Logger.warn('one');
    Logger.warn('two');

    expect(printed).to.equal(2);
    expect(errors).to.equal(1); // logged once until setting changes
    expect(fs.existsSync(escapedPath)).to.be.false;
  });

  it('should reject absolute paths outside the data folder', () => {
    let errors = 0;
    console.error = (): void => {
      errors++;
    };
    const escapedPath = path.join(outsideDir, 'abs-escaped.log');
    Config.Server.Log.file = escapedPath;
    Logger.warn('should not write');

    expect(errors).to.equal(1);
    expect(fs.existsSync(escapedPath)).to.be.false;
  });

  it('should reject symlinks escaping the data folder', () => {
    fs.mkdirSync(outsideDir, {recursive: true});
    const linkDir = path.join(dir, 'linked-logs');
    fs.symlinkSync(outsideDir, linkDir);

    let errors = 0;
    console.error = (): void => {
      errors++;
    };
    Config.Server.Log.file = path.join('linked-logs', 'escaped.log');
    Logger.warn('should not write through symlink');

    expect(errors).to.equal(1);
    expect(fs.existsSync(path.join(outsideDir, 'escaped.log'))).to.be.false;
  });
});
