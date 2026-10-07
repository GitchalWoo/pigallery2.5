import {spawn} from 'node:child_process';
import {readFile, readdir, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd: root, stdio: 'inherit', shell: false, ...options});
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal || code})`));
    });
  });
}

export function runTool(binary, args) {
  return run(process.execPath, [path.join(root, 'node_modules', binary), ...args]);
}

export async function localizeBundles(outputPath) {
  const folders = await readdir(outputPath, {withFileTypes: true});
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const dir = path.join(outputPath, folder.name);
    const indexPath = path.join(dir, 'index.html');
    let html;
    try {
      html = await readFile(indexPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const bundles = (await readdir(dir)).filter(name => /^main(?:[.-].*)?\.js$/.test(name));
    for (const name of bundles) {
      const localizedName = `${folder.name}.${name}`;
      await rename(path.join(dir, name), path.join(dir, localizedName));
      html = html.replaceAll(`src="${name}"`, `src="${localizedName}"`);
    }
    if (bundles.length) await writeFile(indexPath, html);
  }
}

export async function buildFrontend({outputPath = 'dist', languages, release = false} = {}) {
  let locales;
  if (languages) {
    locales = languages.split(',').map(locale => locale.trim()).filter(Boolean);
    const config = JSON.parse(await readFile(path.join(root, 'angular.json'), 'utf8'));
    const {sourceLocale, locales: translations} = config.projects.pigallery2.i18n;
    const supported = [sourceLocale.code, ...Object.keys(translations)];
    if (!locales.length || locales.some(locale => !supported.includes(locale))) {
      throw new Error(`Unsupported languages: ${languages}. Choose from ${supported.join(', ')}.`);
    }
  }
  await run(process.execPath, [path.join(root, 'scripts/frontend.mjs'), JSON.stringify({outputPath, localize: locales || true, extractLicenses: release})]);
  await localizeBundles(path.resolve(root, outputPath));
}
