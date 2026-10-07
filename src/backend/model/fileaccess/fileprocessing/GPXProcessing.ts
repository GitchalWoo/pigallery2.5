import * as path from 'path';
import {constants as fsConstants, promises as fsp} from 'fs';
import {XMLParser, XMLBuilder} from 'fast-xml-parser';
import {ProjectPath} from '../../../ProjectPath';
import {SafePath} from '../SafePath';
import {Config} from '../../../../common/config/private/Config';
import {SupportedFormats} from '../../../../common/SupportedFormats';

type gpxEntry = {
  '@_lat': string | number;
  '@_lon': string | number;
  ele?: unknown;
  time?: string | string[];
  extensions?: unknown;
};

export class GPXProcessing {
  private static readonly GPX_FLOAT_ACCURACY = 6;

  public static isMetaFile(fullPath: string): boolean {
    const extension = path.extname(fullPath).toLowerCase();
    return SupportedFormats.WithDots.MetaFiles.indexOf(extension) !== -1;
  }

  public static isGPXFile(fullPath: string): boolean {
    const extension = path.extname(fullPath).toLowerCase();
    return extension === '.gpx';
  }

  public static generateConvertedPath(filePath: string): string {
    const relDir = ProjectPath.getRelativePathToImages(path.dirname(filePath));
    const safeRelDir = SafePath.resolve(ProjectPath.TranscodedFolder, relDir);
    return path.join(
        safeRelDir,
        path.basename(filePath)
        + '_' + Config.MetaFile.GPXCompressing.minDistance + 'm' +
        Config.MetaFile.GPXCompressing.minTimeDistance + 'ms' +
        Config.MetaFile.GPXCompressing.maxMiddleDeviance + 'm' +
        path.extname(filePath));
  }

  public static async isValidConvertedPath(
      convertedPath: string
  ): Promise<boolean> {
    const origFilePath = path.join(
        ProjectPath.ImageFolder,
        path.relative(
            ProjectPath.TranscodedFolder,
            convertedPath.substring(0, convertedPath.lastIndexOf('_'))
        )
    );


    try {
      await SafePath.resolveExisting(ProjectPath.ImageFolder, path.relative(ProjectPath.ImageFolder, origFilePath));
      await fsp.access(origFilePath, fsConstants.R_OK);
    } catch (e) {
      return false;
    }

    return true;
  }


  static async compressedGPXExist(
      filePath: string
  ): Promise<boolean> {
    // compressed gpx path
    const outPath = GPXProcessing.generateConvertedPath(filePath);

    // check if file already exist
    try {
      await SafePath.resolveExisting(ProjectPath.TempFolder, path.relative(ProjectPath.TempFolder, outPath));
      await fsp.access(outPath, fsConstants.R_OK);
      return true;
    } catch (e) {
      // ignoring errors
    }
    return false;
  }

  public static async compressGPX(
      filePath: string,
  ): Promise<string> {
    // generate compressed gpx path
    const outPath = GPXProcessing.generateConvertedPath(filePath);

    // check if file already exist
    try {
      await SafePath.resolveExisting(ProjectPath.TempFolder, path.relative(ProjectPath.TempFolder, outPath));
      await fsp.access(outPath, fsConstants.R_OK);
      return outPath;
    } catch (e) {
      // ignoring errors
    }


    await SafePath.resolveExisting(ProjectPath.ImageFolder, path.relative(ProjectPath.ImageFolder, filePath));
    await SafePath.resolveForWrite(ProjectPath.TempFolder, path.relative(ProjectPath.TempFolder, outPath));
    const outDir = path.dirname(outPath);

    await fsp.mkdir(outDir, {recursive: true});
    const gpxStr = await fsp.readFile(filePath, 'utf8');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => ['trk', 'trkseg', 'trkpt'].includes(name)
    });
    const gpxObj = parser.parse(gpxStr);

    if (gpxObj.gpx?.trk?.[0]?.trkseg?.[0]?.trkpt) { // only compress paths if there is any
      const distance = (entry1: gpxEntry, entry2: gpxEntry) => {
        const lat1 = parseFloat(String(entry1['@_lat']));
        const lon1 = parseFloat(String(entry1['@_lon']));
        const lat2 = parseFloat(String(entry2['@_lat']));
        const lon2 = parseFloat(String(entry2['@_lon']));

        // credits to: https://www.movable-type.co.uk/scripts/latlong.html
        const R = 6371e3; // metres
        const φ1 = lat1 * Math.PI / 180; // φ, λ in radians
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        const d = R * c; // in metres
        return d;
      };

      const getTime = (entry?: gpxEntry): number => {
        if (!entry?.time) {
          return NaN;
        }
        const t = Array.isArray(entry.time) ? entry.time[0] : entry.time;
        return Date.parse(t);
      };

      const gpxEntryFilter = (value: gpxEntry, i: number, list: gpxEntry[]) => {
        if (i === 0 || i >= list.length - 1) { // always keep the first and last items
          return true;
        }
        const timeDelta = getTime(list[i]) - getTime(list[i - 1]); // mill sec.
        const dist = distance(list[i - 1], list[i]); // meters

        // if time is not available, consider it as all points are created the same time
        return !((isNaN(timeDelta) || timeDelta < Config.MetaFile.GPXCompressing.minTimeDistance) &&
            dist < Config.MetaFile.GPXCompressing.minDistance);
      };

      const postFilter = (i: number, list: gpxEntry[]) => {
        if (i === 0 || i >= list.length - 1) { // always keep the first and last items
          return true;
        }
        /* if point on the same line that the next and prev point would draw, lets skip it*/
        const avg = (a: string | number, b: string | number) =>
          ((parseFloat(String(a)) + parseFloat(String(b))) / 2).toFixed(this.GPX_FLOAT_ACCURACY);
        const modPoint: gpxEntry = {
          '@_lat': avg(list[i - 1]['@_lat'], list[i + 1]['@_lat']),
          '@_lon': avg(list[i - 1]['@_lon'], list[i + 1]['@_lon'])
        };
        if (list[i].time) {
          modPoint.time = list[i].time;
        }

        const deviation = distance(modPoint, list[i]); // meters
        return !(deviation < Config.MetaFile.GPXCompressing.maxMiddleDeviance); // keep if deviation is too big
      };

      for (let i = 0; i < gpxObj.gpx.trk.length; ++i) {
        if (!gpxObj.gpx.trk[i]?.trkseg) {
          continue;
        }
        for (let j = 0; j < gpxObj.gpx.trk[i].trkseg.length; ++j) {
          const trkseg: { trkpt?: gpxEntry[] } = gpxObj.gpx.trk[i].trkseg[j];
          if (!trkseg?.trkpt) {
            continue;
          }

          trkseg.trkpt = trkseg.trkpt.filter(gpxEntryFilter).map((v) => {
            v['@_lon'] = parseFloat(String(v['@_lon'])).toFixed(this.GPX_FLOAT_ACCURACY);
            v['@_lat'] = parseFloat(String(v['@_lat'])).toFixed(this.GPX_FLOAT_ACCURACY);
            delete v.ele;
            delete v.extensions;
            return v;
          });

          for (let k = 0; k < trkseg.trkpt.length; ++k) {
            if (!postFilter(k, trkseg.trkpt)) {
              trkseg.trkpt.splice(k, 1);
              --k;
            }
          }
        }
      }
    }
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      format: false
    });
    await fsp.writeFile(outPath, builder.build(gpxObj));

    return outPath;
  }

}

