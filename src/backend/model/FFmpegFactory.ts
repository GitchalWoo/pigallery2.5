import {ChildProcess, spawn} from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {EventEmitter} from 'events';

export interface FfprobeStream {
  index: number;
  codec_name?: string;
  codec_long_name?: string;
  profile?: string;
  codec_type?: 'video' | 'audio' | 'subtitle' | 'data' | string;
  width?: number;
  height?: number;
  rotation?: number;
  duration?: string | number;
  bit_rate?: string | number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  tags?: Record<string, any>;
  side_data_list?: Array<{
    side_data_type?: string;
    rotation?: number;
    [key: string]: any;
  }>;
  [key: string]: any;
}

export interface FfprobeFormat {
  filename?: string;
  nb_streams?: number;
  format_name?: string;
  format_long_name?: string;
  duration?: number;
  bit_rate?: number;
  size?: number;
  tags?: Record<string, any>;
  [key: string]: any;
}

export interface FfprobeData {
  streams: FfprobeStream[];
  format: FfprobeFormat;
  chapters?: any[];
}

export interface ScreenshotConfig {
  timemarks?: (string | number)[];
  timestamps?: (string | number)[];
  size?: string;
  filename: string;
  folder: string;
}

export class FFmpegCommand extends EventEmitter {
  private inputPath?: string;
  private inputOptionsList: string[] = [];
  private outputOptionsList: string[] = [];
  private videoBitrateValue?: string;
  private videoCodecValue?: string;
  private fpsValue?: number;
  private sizeValue?: string;
  private formatValue?: string;
  private outputPathValue?: string;
  private currentChildProcess?: ChildProcess;

  constructor(inputPath?: string) {
    super();
    this.inputPath = inputPath;
  }

  public input(inputPath: string): this {
    this.inputPath = inputPath;
    return this;
  }

  public inputOptions(options: string | string[]): this {
    if (Array.isArray(options)) {
      this.inputOptionsList.push(...options);
    } else if (typeof options === 'string') {
      this.inputOptionsList.push(options);
    }
    return this;
  }

  public outputOptions(options: string | string[]): this {
    if (Array.isArray(options)) {
      this.outputOptionsList.push(...options);
    } else if (typeof options === 'string') {
      this.outputOptionsList.push(options);
    }
    return this;
  }

  public addOption(options: string | string[]): this {
    return this.outputOptions(options);
  }

  public videoBitrate(bitrate: string | number): this {
    this.videoBitrateValue = ('' + bitrate).replace(/k?$/, 'k');
    return this;
  }

  public videoCodec(codec: string): this {
    this.videoCodecValue = codec;
    return this;
  }

  public fps(fps: number): this {
    this.fpsValue = fps;
    return this;
  }

  public size(size: string): this {
    this.sizeValue = size;
    return this;
  }

  public format(format: string): this {
    this.formatValue = format;
    return this;
  }

  public save(outputPath: string): this {
    this.outputPathValue = outputPath;
    this.run();
    return this;
  }

  public kill(signal: NodeJS.Signals = 'SIGKILL'): void {
    if (this.currentChildProcess && !this.currentChildProcess.killed) {
      this.currentChildProcess.kill(signal);
    }
  }

  public ffprobe(cb?: (err: Error | null, data?: FfprobeData) => void): Promise<FfprobeData> {
    if (!this.inputPath) {
      const err = new Error('No input specified for ffprobe');
      if (cb) cb(err);
      return Promise.reject(err);
    }
    const promise = FFmpegFactory.probe(this.inputPath);
    if (cb) {
      promise.then(data => cb(null, data), err => cb(err));
    }
    return promise;
  }

  public getAvailableCodecs(cb: (err: Error | null, codecs?: any) => void): void {
    const ffmpegBin = FFmpegFactory.getFfmpegPath();
    const child = spawn(ffmpegBin, ['-codecs'], {windowsHide: true, shell: false});
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      cb(err);
    });
    child.on('close', (code) => {
      if (code === 0) {
        cb(null, {});
      } else {
        cb(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
      }
    });
  }

  public takeScreenshots(config: ScreenshotConfig): this {
    process.nextTick(async () => {
      try {
        if (!this.inputPath) {
          throw new Error('No input specified for screenshots');
        }
        const timemark = config.timemarks?.[0] ?? config.timestamps?.[0] ?? '10%';
        let seekSeconds = 0;
        if (typeof timemark === 'string' && timemark.endsWith('%')) {
          const percent = parseFloat(timemark) / 100;
          const probeData = await FFmpegFactory.probe(this.inputPath);
          const vStream = probeData.streams?.find(
            s => s.codec_type === 'video' || (s.width !== undefined && s.height !== undefined)
          );
          const duration =
            (vStream?.duration !== undefined ? parseFloat('' + vStream.duration) : undefined) ||
            probeData.format?.duration ||
            0;
          seekSeconds = duration * percent;
        } else if (typeof timemark === 'number') {
          seekSeconds = timemark;
        } else if (typeof timemark === 'string') {
          seekSeconds = parseFloat(timemark) || 0;
        }

        const folder = config.folder || '.';
        await fs.promises.mkdir(folder, {recursive: true});
        const outPath = path.join(folder, config.filename);

        const args = this.buildScreenshotArgs(outPath, config.size, seekSeconds);

        await this.executeFfmpeg(args);
        this.emit('end');
      } catch (err: any) {
        this.emit('error', err);
      }
    });
    return this;
  }

  public buildScreenshotArgs(outPath: string, size?: string, seekSeconds?: number): string[] {
    const args: string[] = [];
    if (seekSeconds !== undefined && seekSeconds > 0) {
      args.push('-ss', seekSeconds.toFixed(6));
    }
    if (this.inputPath) {
      args.push('-i', this.inputPath);
    }
    args.push('-y');

    const scaleFilter = size ? this.computeScaleFilter(size) : null;
    if (scaleFilter) {
      args.push('-vf', scaleFilter);
    }
    args.push('-vframes', '1');

    for (const opt of this.outputOptionsList) {
      args.push(...this.splitOptions(opt));
    }
    args.push(outPath);
    return args;
  }

  public buildArgs(): string[] {
    const args: string[] = [];
    for (const opt of this.inputOptionsList) {
      args.push(...this.splitOptions(opt));
    }
    if (this.inputPath) {
      args.push('-i', this.inputPath);
    }
    args.push('-y');

    if (this.videoBitrateValue) {
      args.push('-b:v', this.videoBitrateValue);
    }
    if (this.videoCodecValue) {
      args.push('-vcodec', this.videoCodecValue);
    }
    if (this.fpsValue) {
      args.push('-r', this.fpsValue.toString());
    }
    if (this.sizeValue) {
      const scaleFilter = this.computeScaleFilter(this.sizeValue);
      if (scaleFilter) {
        args.push('-filter:v', scaleFilter);
      }
    }
    for (const opt of this.outputOptionsList) {
      args.push(...this.splitOptions(opt));
    }
    if (this.formatValue) {
      args.push('-f', this.formatValue);
    }
    if (this.outputPathValue) {
      args.push(this.outputPathValue);
    }
    return args;
  }

  public run(): this {
    process.nextTick(async () => {
      try {
        const args = this.buildArgs();

        await this.executeFfmpeg(args);
        this.emit('end');
      } catch (err: any) {
        this.emit('error', err);
      }
    });
    return this;
  }

  private computeScaleFilter(size: string): string {
    const fixedWidth = size.match(/^(\d+)x\?$/);
    if (fixedWidth) {
      const w = Math.round(Number(fixedWidth[1]) / 2) * 2;
      return `scale=w=${w}:h=trunc(ow/a/2)*2`;
    }
    const fixedHeight = size.match(/^\?x(\d+)$/);
    if (fixedHeight) {
      const h = Math.round(Number(fixedHeight[1]) / 2) * 2;
      return `scale=w=trunc(oh*a/2)*2:h=${h}`;
    }
    const fixedBoth = size.match(/^(\d+)x(\d+)$/);
    if (fixedBoth) {
      const w = Math.round(Number(fixedBoth[1]) / 2) * 2;
      const h = Math.round(Number(fixedBoth[2]) / 2) * 2;
      return `scale=w=${w}:h=${h}`;
    }
    const percent = size.match(/^(\d+)%$/);
    if (percent) {
      const ratio = (parseFloat(percent[1]) / 100).toFixed(4);
      return `scale=w=trunc(iw*${ratio}/2)*2:h=trunc(ih*${ratio}/2)*2`;
    }
    return `scale=${size}`;
  }

  private splitOptions(opt: string): string[] {
    const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
    const matches: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(opt)) !== null) {
      matches.push(match[1] !== undefined ? match[1] : (match[2] !== undefined ? match[2] : match[0]));
    }
    return matches.length > 0 ? matches : [opt];
  }

  private executeFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpegBin = FFmpegFactory.getFfmpegPath();
      const fullCmd = `${ffmpegBin} ${args.join(' ')}`;
      this.emit('start', fullCmd);

      const child = spawn(ffmpegBin, args, {windowsHide: true, shell: false});
      this.currentChildProcess = child;

      let stderrTail = '';
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderrTail = (stderrTail + text).slice(-4000);
        const lines = text.split(/\r\n|\r|\n/);
        for (const line of lines) {
          if (line.trim().length > 0) {
            this.emit('stderr', line);
          }
        }
      });

      child.on('error', (err) => {
        this.currentChildProcess = undefined;
        reject(new Error(`Failed to start ffmpeg (${fullCmd}): ${err.message}`));
      });

      child.on('close', (code, signal) => {
        this.currentChildProcess = undefined;
        if (code === 0) {
          resolve();
        } else {
          const detail = signal ? `killed with signal ${signal}` : `exited with code ${code}`;
          reject(new Error(`ffmpeg ${detail}: ${stderrTail.trim() || 'unknown error'}`));
        }
      });
    });
  }
}

export type FFmpegFactoryGetter = {
  (path?: string): FFmpegCommand;
  setFfmpegPath(p: string): void;
  setFfprobePath(p: string): void;
};

/* eslint-disable @typescript-eslint/no-var-requires */
export class FFmpegFactory {
  private static ffmpegPath: string | null = null;
  private static ffprobePath: string | null = null;

  public static getFfmpegPath(): string {
    if (this.ffmpegPath) {
      return this.ffmpegPath;
    }
    if (process.env.FFMPEG_PATH) {
      return process.env.FFMPEG_PATH;
    }
    try {
      const p = require('ffmpeg-static');
      if (typeof p === 'string' && p.length > 0 && fs.existsSync(p)) {
        return p;
      }
    } catch {
      // ignore
    }
    return 'ffmpeg';
  }

  public static getFfprobePath(): string {
    if (this.ffprobePath) {
      return this.ffprobePath;
    }
    if (process.env.FFPROBE_PATH) {
      return process.env.FFPROBE_PATH;
    }
    try {
      const p = require('ffprobe-static');
      if (p && typeof p.path === 'string' && p.path.length > 0 && fs.existsSync(p.path)) {
        return p.path;
      }
    } catch {
      // ignore
    }
    return 'ffprobe';
  }

  public static setFfmpegPath(path: string): void {
    this.ffmpegPath = path;
  }

  public static setFfprobePath(path: string): void {
    this.ffprobePath = path;
  }

  public static createCommand(inputPath?: string): FFmpegCommand {
    return new FFmpegCommand(inputPath);
  }

  public static get(): FFmpegFactoryGetter {
    const fn = ((inputPath?: string) => new FFmpegCommand(inputPath)) as FFmpegFactoryGetter;
    fn.setFfmpegPath = (p: string) => FFmpegFactory.setFfmpegPath(p);
    fn.setFfprobePath = (p: string) => FFmpegFactory.setFfprobePath(p);
    return fn;
  }

  public static probe(filePath: string): Promise<FfprobeData> {
    return new Promise((resolve, reject) => {
      const ffprobeBin = FFmpegFactory.getFfprobePath();
      const args = [
        '-v', 'error',
        '-show_streams',
        '-show_format',
        '-print_format', 'json',
        filePath
      ];
      const child = spawn(ffprobeBin, args, {windowsHide: true, shell: false});
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      child.on('error', (err) => {
        reject(new Error(`Failed to start ffprobe: ${err.message}`));
      });
      child.on('close', (code, signal) => {
        if (code !== 0) {
          const detail = signal ? `killed with signal ${signal}` : `exited with code ${code}`;
          return reject(new Error(`ffprobe ${detail}: ${stderr.trim() || 'unknown error'}`));
        }
        try {
          const raw = JSON.parse(stdout);
          const data = FFmpegFactory.normalizeFfprobeData(raw);
          resolve(data);
        } catch (err: any) {
          reject(new Error(`Failed to parse ffprobe JSON output: ${err.message}\n${stdout.slice(0, 500)}`));
        }
      });
    });
  }

  public static normalizeFfprobeData(raw: any): FfprobeData {
    const data: FfprobeData = {
      streams: [],
      format: raw.format || {},
      chapters: raw.chapters || []
    };

    if (data.format) {
      if (data.format.duration !== undefined) {
        data.format.duration = parseFloat('' + data.format.duration);
      }
      if (data.format.bit_rate !== undefined) {
        data.format.bit_rate = parseInt('' + data.format.bit_rate, 10);
      }
      if (data.format.size !== undefined) {
        data.format.size = parseInt('' + data.format.size, 10);
      }
    }

    if (Array.isArray(raw.streams)) {
      data.streams = raw.streams.map((s: any) => {
        const stream: FfprobeStream = {...s};
        if (stream.width !== undefined) {
          stream.width = parseInt('' + stream.width, 10);
        }
        if (stream.height !== undefined) {
          stream.height = parseInt('' + stream.height, 10);
        }
        let rot: any = stream.side_data_list?.find((sd: any) => sd.rotation !== undefined)?.rotation;
        if (rot === undefined && stream.tags?.rotate !== undefined) {
          rot = parseInt(stream.tags.rotate, 10);
        }
        if (rot !== undefined && !isNaN(rot)) {
          stream.rotation = rot;
        }
        return stream;
      });
    }

    return data;
  }
}
