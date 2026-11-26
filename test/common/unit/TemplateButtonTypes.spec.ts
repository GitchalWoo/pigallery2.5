import {expect} from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import {parseTemplate, type TmplAstElement, TmplAstRecursiveVisitor, tmplAstVisitAll} from '@angular/compiler';

// A button without a type submits its form: the Enter key in any field of the form clicks
// the first one (e.g. it deleted a setting or cleared the random link query) #1214.
// ng lint checks it too (@angular-eslint/template/button-has-type); this keeps it in the test suite.
describe('Frontend templates', () => {
  const root = path.join(__dirname, '../../../src/frontend');

  const templates = (dir: string): string[] =>
    fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        return templates(p);
      }
      return e.name.endsWith('.component.html') ? [p] : [];
    });

  // walks every element, also inside @if, @for, @switch, @defer and ng-template
  class UntypedButtons extends TmplAstRecursiveVisitor {
    readonly lines: number[] = [];

    override visitElement(element: TmplAstElement): void {
      if (element.name === 'button' &&
        !element.attributes.some((a) => a.name === 'type') &&
        !element.inputs.some((i) => i.name === 'type')) {
        this.lines.push(element.sourceSpan.start.line + 1);
      }
      super.visitElement(element);
    }
  }

  // a clickable menu item must be a native button or link, so Tab, Enter and Space reach it
  // (sort, group and grid size menus, adapted from upstream 23eb43d7)
  class ClickableMenuItems extends TmplAstRecursiveVisitor {
    readonly lines: number[] = [];

    override visitElement(element: TmplAstElement): void {
      if (element.attributes.some((a) => a.name === 'role' && a.value === 'menuitem') &&
        element.outputs.some((o) => o.name === 'click') &&
        element.name !== 'button' && element.name !== 'a') {
        this.lines.push(element.sourceSpan.start.line + 1);
      }
      super.visitElement(element);
    }
  }

  const findIn = (files: string[], create: () => {lines: number[]} & TmplAstRecursiveVisitor): string[] => {
    const found: string[] = [];
    for (const f of files) {
      const parsed = parseTemplate(fs.readFileSync(f, 'utf8'), f);
      expect(parsed.errors ?? [], f).to.deep.equal([]);
      const visitor = create();
      tmplAstVisitAll(visitor, parsed.nodes);
      for (const line of visitor.lines) {
        found.push(path.relative(root, f) + ':' + line);
      }
    }
    return found;
  };

  it('should make every clickable menu item a button or a link', () => {
    const files = templates(root);
    expect(files.length).to.be.greaterThan(50);
    expect(findIn(files, () => new ClickableMenuItems())).to.deep.equal([]);
  });

  it('should give every button a type', () => {
    const files = templates(root);
    expect(files.length).to.be.greaterThan(50);
    expect(findIn(files, () => new UntypedButtons())).to.deep.equal([]);
  });
});
