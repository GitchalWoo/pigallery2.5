import {ClientClass} from './config/public/Config';

let Config: ClientClass;

if (typeof window !== 'undefined') {
  Config = require('./config/public/Config').Config;
} else {
  Config = require('./config/private/Config').Config;
}

export class SupportedFormats {
  // Filled by init() from the loaded config.
  static Photos: string[] = [];
  // Browser-supported video formats
  // Read more: https://www.w3schools.com/html/html5_video.asp
  static Videos: string[] = [];
  static MetaFiles: string[] = [];
  // These formats need to be transcoded (with the built-in ffmpeg support)
  static TranscodeNeed = {
    // based on libvips, all supported formats for sharp: https://github.com/libvips/libvips
    Photos: [] as string[],
    Videos: [] as string[],
  };
  static WithDots = {
    Photos: [] as string[],
    Videos: [] as string[],
    MetaFiles: [] as string[],
    TranscodeNeed: {
      Photos: [] as string[],
      Videos: [] as string[],
    }
  };

  /**
   * (Re)reads the formats from the config.
   * Call it again after the config's format lists change (e.g. the startup check removes a format
   * that sharp cannot decode), the indexer reads the formats from here.
   */
  static init(): void {
    SupportedFormats.TranscodeNeed.Videos = Config.Media.Video.supportedFormatsWithTranscoding.slice();
    SupportedFormats.Photos = Config.Media.Photo.supportedFormats.concat(
      SupportedFormats.TranscodeNeed.Photos
    );
    SupportedFormats.Videos = Config.Media.Video.supportedFormats.concat(
      SupportedFormats.TranscodeNeed.Videos
    );
    SupportedFormats.MetaFiles = Config.MetaFile.supportedFormats.slice();
    SupportedFormats.WithDots.Photos = SupportedFormats.Photos.map((f) => '.' + f);
    SupportedFormats.WithDots.Videos = SupportedFormats.Videos.map((f) => '.' + f);
    SupportedFormats.WithDots.MetaFiles = SupportedFormats.MetaFiles.map(
      (f) => '.' + f
    );
    SupportedFormats.WithDots.TranscodeNeed.Photos =
      SupportedFormats.TranscodeNeed.Photos.map((f) => '.' + f);
    SupportedFormats.WithDots.TranscodeNeed.Videos =
      SupportedFormats.TranscodeNeed.Videos.map((f) => '.' + f);
  }
}
SupportedFormats.init();
