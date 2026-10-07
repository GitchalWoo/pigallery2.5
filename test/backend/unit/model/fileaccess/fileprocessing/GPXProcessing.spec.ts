import assert from 'assert/strict';
import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {ProjectPath} from '../../../../../../src/backend/ProjectPath';
import {GPXProcessing} from '../../../../../../src/backend/model/fileaccess/fileprocessing/GPXProcessing';
import {XMLParser} from 'fast-xml-parser';

describe('GPXProcessing', () => {
  let root: string;
  let originalImageFolder: string;
  let originalTempFolder: string;
  let originalTranscodedFolder: string;

  beforeEach(() => {
    originalImageFolder = ProjectPath.ImageFolder;
    originalTempFolder = ProjectPath.TempFolder;
    originalTranscodedFolder = ProjectPath.TranscodedFolder;

    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-gpx-test-'));
    ProjectPath.ImageFolder = path.join(root, 'gallery');
    ProjectPath.TempFolder = path.join(root, 'cache');
    ProjectPath.TranscodedFolder = path.join(ProjectPath.TempFolder, 'tc');

    fs.mkdirSync(ProjectPath.ImageFolder, {recursive: true});
    fs.mkdirSync(ProjectPath.TranscodedFolder, {recursive: true});
  });

  afterEach(() => {
    ProjectPath.ImageFolder = originalImageFolder;
    ProjectPath.TempFolder = originalTempFolder;
    ProjectPath.TranscodedFolder = originalTranscodedFolder;
    fs.rmSync(root, {recursive: true, force: true});
  });

  it('should identify meta files and GPX files', () => {
    assert.equal(GPXProcessing.isGPXFile('track.gpx'), true);
    assert.equal(GPXProcessing.isGPXFile('track.GPX'), true);
    assert.equal(GPXProcessing.isGPXFile('track.jpg'), false);
    assert.equal(GPXProcessing.isMetaFile('track.gpx'), true);
  });

  it('should compress a GPX file using fast-xml-parser', async () => {
    const rawGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Test">
  <trk>
    <name>Test Track</name>
    <trkseg>
      <trkpt lat="47.100000" lon="19.100000">
        <ele>120</ele>
        <time>2026-01-01T10:00:00Z</time>
      </trkpt>
      <trkpt lat="47.100001" lon="19.100001">
        <ele>121</ele>
        <time>2026-01-01T10:00:01Z</time>
      </trkpt>
      <trkpt lat="47.200000" lon="19.200000">
        <ele>150</ele>
        <time>2026-01-01T11:00:00Z</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

    const srcGpxPath = path.join(ProjectPath.ImageFolder, 'activity.gpx');
    fs.writeFileSync(srcGpxPath, rawGpx, 'utf8');

    const compressedPath = await GPXProcessing.compressGPX(srcGpxPath);
    assert.ok(fs.existsSync(compressedPath));

    const content = fs.readFileSync(compressedPath, 'utf8');
    assert.ok(content.includes('<gpx'));

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      isArray: (name) => ['trk', 'trkseg', 'trkpt'].includes(name)
    });
    const parsed = parser.parse(content);
    assert.equal(parsed.gpx['@_version'], '1.1');
    assert.ok(parsed.gpx.trk[0].trkseg[0].trkpt.length >= 2);
    // Elevation should be stripped during compression
    assert.equal(parsed.gpx.trk[0].trkseg[0].trkpt[0].ele, undefined);
  });
});
