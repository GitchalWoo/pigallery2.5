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
    const originalHtml = html;
    // Angular 22.3's parse5 HTML rewriter escapes `<` and `>` inside attribute values
    // (e.g. `data-gallery-design="&lt;%= ... %&gt;"`, `<base href="&lt;%= ... %&gt;/">`).
    // Restore EJS template delimiters so Express/EJS evaluates them at request time.
    html = html.replace(/&lt;%([\s\S]*?)%&gt;/g, (_, expr) => `<%${expr.replaceAll('&amp;', '&')}%>`);
    const bundles = (await readdir(dir)).filter(name => /^main(?:[.-].*)?\.js$/.test(name));
    const renames = [];
    for (const name of bundles) {
      const localizedName = `${folder.name}.${name}`;
      await rename(path.join(dir, name), path.join(dir, localizedName));
      html = html
        .replaceAll(`src="${name}"`, `src="${localizedName}"`)
        .replaceAll(`href="${name}"`, `href="${localizedName}"`);
      renames.push([name, localizedName]);
    }
    if (renames.length) {
      // Angular 22.3 / rolldown lazy chunks import shared symbols back from `./main-<hash>.js`.
      // Rewrite those relative module specifiers to match the localized main bundle filename.
      const jsFiles = (await readdir(dir)).filter(name => name.endsWith('.js'));
      for (const jsFile of jsFiles) {
        const jsPath = path.join(dir, jsFile);
        const content = await readFile(jsPath, 'utf8');
        let updated = content;
        for (const [oldName, newName] of renames) {
          updated = updated
            .replaceAll(`"./${oldName}"`, `"./${newName}"`)
            .replaceAll(`'./${oldName}'`, `'./${newName}'`);
        }
        if (updated !== content) await writeFile(jsPath, updated);
      }
    }
    if (bundles.length || html !== originalHtml) await writeFile(indexPath, html);
  }
}

export async function buildFrontend({outputPath = 'dist', languages, release = false, statsJson = false, buildInfo} = {}) {
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
  // Keep dist/<locale>/ and release/dist/<locale>/ without the builder's browser/ subdirectory.
  await run(process.execPath, [path.join(root, 'scripts/frontend.mjs'), JSON.stringify({
    outputPath: {base: outputPath, browser: '', media: 'assets'},
    localize: locales || true,
    extractLicenses: release,
    statsJson,
    define: {
      PIGALLERY_BUILD_INFO: JSON.stringify(buildInfo),
    },
  })]);
  await localizeBundles(path.resolve(root, outputPath));
}
