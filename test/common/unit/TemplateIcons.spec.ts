import {expect} from 'chai';
import * as fs from 'fs';
import * as path from 'path';

// ng-icons renders nothing for an icon that is not registered (e.g. the login button and the
// uploader's done/failed marks had no icon, adapted from upstream 04ccd74d).
describe('Frontend icons', () => {
  const root = path.join(__dirname, '../../../src/frontend');

  const files = (dir: string, accept: (name: string) => boolean): string[] =>
    fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        return files(p, accept);
      }
      return accept(e.name) ? [p] : [];
    });

  const registered = (): Set<string> => {
    const main = fs.readFileSync(path.join(root, 'main.ts'), 'utf8');
    const block = main.substring(main.indexOf('NgIconsModule.withIcons({'));
    return new Set(block.substring(0, block.indexOf('})')).match(/\bion[A-Z]\w*/g));
  };

  it('registers every icon the templates and components name', () => {
    const icons = registered();
    const missing: string[] = [];
    const sources = files(path.join(root, 'app'), (n) => n.endsWith('.html') ||
      (n.endsWith('.ts') && !n.endsWith('.spec.ts')));
    for (const file of sources) {
      const text = fs.readFileSync(file, 'utf8');
      // name="ionX" in templates, 'ionX' string literals in code
      const used = text.match(/["']ion[A-Z]\w*["']/g) || [];
      for (const icon of used.map((u) => u.slice(1, -1))) {
        if (!icons.has(icon)) {
          missing.push(path.relative(root, file) + ': ' + icon);
        }
      }
    }
    expect(missing).to.deep.equal([]);
  });
});
