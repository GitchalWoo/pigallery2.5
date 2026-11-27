import {expect} from 'chai';
import { readFile } from 'fs/promises';
import {ExtensionRepository} from '../../../../../src/backend/model/extension/ExtensionRepository';
import {ProjectPath} from '../../../../../src/backend/ProjectPath';
import path = require('path');

// to help WebStorm to handle the test cases
declare let describe: any;
declare const it: any;


describe('ExtensionRepository', () => {

  it('should parse MD repo file', async () => {

    const text = await readFile(path.join(ProjectPath.Root,'extension/REPOSITORY.md'), 'utf8');
    const extensions = (new ExtensionRepository()).repoMD(text);
    expect(extensions[0].id).to.deep.equal('sample-extension');
  });

  it('should parse a manual-install extension without a zip URL', () => {
    const text = `# Pigallery2 extension repository

|     **Name**     | **Url** | **Readme** | **Download** |   |
|:----------------:|:--------:|:----------:|:------------:|---|
| Manual extension | [manual](https://example.com/manual) | [README.md](https://example.com/readme) | |   |`;
    const extensions = (new ExtensionRepository()).repoMD(text);

    expect(extensions).to.have.length(1);
    expect(extensions[0].id).to.equal('manual-extension');
    expect(extensions[0].url).to.equal('https://example.com/manual');
    expect(extensions[0].zipUrl).to.equal(undefined);
  });

  it('should keep a plain url instead of failing on it', () => {
    const repo = new ExtensionRepository() as unknown as {getUrlFromMDLink: (t: string) => string};
    expect(repo.getUrlFromMDLink('https://example.com/ext.zip')).to.equal('https://example.com/ext.zip');
    expect(repo.getUrlFromMDLink('[Download](https://example.com/ext.zip)')).to.equal('https://example.com/ext.zip');
    expect(repo.getUrlFromMDLink('[Readme](/relative/README.md)')).to.equal('[Readme](/relative/README.md)');
  });
});
