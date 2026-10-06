import {expect} from 'chai';
import {Utils} from '../../../src/common/Utils';

describe('Utils', () => {
  it('should concat urls', () => {
    expect(Utils.concatUrls('\\')).to.be.equal('.');
    expect(Utils.concatUrls('\\*')).to.be.equal('/*');
    expect(Utils.concatUrls('abc', 'cde')).to.be.equal('abc/cde');
    expect(Utils.concatUrls('abc/', 'cde')).to.be.equal('abc/cde');
    expect(Utils.concatUrls('abc\\', 'cde')).to.be.equal('abc/cde');
    expect(Utils.concatUrls('abc/', 'cde/')).to.be.equal('abc/cde');
    expect(Utils.concatUrls('./abc\\', 'cde/')).to.be.equal('./abc/cde');
    expect(Utils.concatUrls('/abc\\', 'cde/')).to.be.equal('/abc/cde');
    expect(Utils.concatUrls('abc/', '\\cde/')).to.be.equal('abc/cde');
    expect(Utils.concatUrls('/abc/', '\\cde/')).to.be.equal('/abc/cde');
    expect(Utils.concatUrls('abc\\', '\\cde/')).to.be.equal('abc/cde');
    expect(Utils.concatUrls('abc\\', '/cde/')).to.be.equal('abc/cde');
    expect(Utils.concatUrls('abc/', '/cde/')).to.be.equal('abc/cde');
    expect(Utils.concatUrls('abc\\/', '/cde/')).to.be.equal('abc/cde');
    expect(Utils.concatUrls('abc\\/', '/cde/', 'fgh')).to.be.equal('abc/cde/fgh');
    expect(Utils.concatUrls('abc\\/', '////cde/', 'fgh')).to.be.equal('abc/cde/fgh');
    expect(Utils.concatUrls('http://abc\\/', '/cde/', 'fgh')).to.be.equal('http://abc/cde/fgh');
    expect(Utils.concatUrls('https://abc\\/', '/cde/', 'fgh')).to.be.equal('https://abc/cde/fgh');
  });

  it('should find closest number', () => {

    expect(Utils.findClosest(10, [10, 13, 4, 20])).to.be.equal(10);
    expect(Utils.findClosest(10, [13, 4, 20])).to.be.equal(13);
    expect(Utils.findClosest(10, [4, 20])).to.be.equal(4);
    expect(Utils.findClosest(10, [20])).to.be.equal(20);
  });

  it('should preserve the sign of negative sub-hour offsets', () => {
    expect(Utils.getOffsetMinutes('-00:30')).to.equal(-30);
    expect(Utils.getOffsetMinutes('-01:30')).to.equal(-90);
    expect(Utils.getOffsetMinutes('+00:30')).to.equal(30);
  });

  it('should find closest number in sorted array', () => {

    expect(Utils.findClosestinSorted(10, [3, 5, 8, 10, 15, 20])).to.be.equal(10);
    expect(Utils.findClosestinSorted(10, [3, 5, 8, 15, 20])).to.be.equal(8);
    expect(Utils.findClosestinSorted(10, [3, 5, 15, 20])).to.be.equal(15);
    expect(Utils.findClosestinSorted(10, [3, 5, 20])).to.be.equal(5);
    expect(Utils.findClosestinSorted(10, [3, 20])).to.be.equal(3);
    expect(Utils.findClosestinSorted(10, [20])).to.be.equal(20);
  });
  it('should equal', () => {

    expect(Utils.equalsFilter('abc', 'abc')).to.be.equal(true);
    expect(Utils.equalsFilter('abc', 'abcd')).to.be.equal(false);
    expect(Utils.equalsFilter(10, 10)).to.be.equal(true);
    expect(Utils.equalsFilter(10, 11)).to.be.equal(false);
    expect(Utils.equalsFilter(true, true)).to.be.equal(true);
    expect(Utils.equalsFilter(false, false)).to.be.equal(true);
    expect(Utils.equalsFilter(false, true)).to.be.equal(false);
    expect(Utils.equalsFilter(true, false)).to.be.equal(false);
    expect(Utils.equalsFilter(0, false)).to.be.equal(false);
    expect(Utils.equalsFilter(0, 0)).to.be.equal(true);
    expect(Utils.equalsFilter(false, 0)).to.be.equal(false);
    expect(Utils.equalsFilter(null, null)).to.be.equal(true);
    expect(Utils.equalsFilter(null, false)).to.be.equal(false);
    expect(Utils.equalsFilter(false, null)).to.be.equal(false);
    expect(Utils.equalsFilter({a: 0}, {b: 0})).to.be.equal(false);
    expect(Utils.equalsFilter({a: 0}, {a: 0})).to.be.equal(true);
  });

  describe('sortableFilename', () => {
    it('should trim extensions', () => {
      expect(Utils.sortableFilename("10.jpg")).to.be.equal("10")
    })

    it('should not trim dotfiles to empty strings', () => {
      expect(Utils.sortableFilename(".file")).to.be.equal(".file")
    })

    it('should trim dotfiles with extensions', () => {
      expect(Utils.sortableFilename(".favourite.jpg")).to.be.equal(".favourite")
    })

    it('should not trim without dots', () => {
      expect(Utils.sortableFilename("hello_world")).to.be.equal("hello_world")
    })
  })

  describe('cleanNaN', () => {
    it('should replace nested non-finite numbers with null', () => {
      const obj = {
        a: NaN,
        b: {c: Infinity, d: -Infinity, e: 1.5, f: 0},
        arr: [1, NaN, 3]
      };
      Utils.cleanNaN(obj);
      expect(obj).to.deep.equal({
        a: null,
        b: {c: null, d: null, e: 1.5, f: 0},
        arr: [1, null, 3]
      });
    });

    it('should preserve strings, booleans, null and dates', () => {
      const date = new Date(0);
      const obj = {s: 'NaN', k: ['NaN', 'Infinity'], t: true, n: null as null, u: undefined as undefined, date};
      Utils.cleanNaN(obj);
      expect(obj.s).to.equal('NaN');
      expect(obj.k).to.deep.equal(['NaN', 'Infinity']);
      expect(obj.t).to.equal(true);
      expect(obj.n).to.equal(null);
      expect(obj.u).to.equal(undefined);
      expect(obj.date).to.equal(date);
      expect(obj.date.getTime()).to.equal(0);
    });

    it('should handle reference cycles', () => {
      const parent: Record<string, unknown> = {v: NaN};
      const child: Record<string, unknown> = {parent, w: Infinity};
      parent['child'] = child;
      Utils.cleanNaN(parent);
      expect(parent['v']).to.equal(null);
      expect(child['w']).to.equal(null);
    });

    it('should ignore non-object input', () => {
      expect(() => Utils.cleanNaN(null)).to.not.throw();
      expect(() => Utils.cleanNaN(NaN)).to.not.throw();
      expect(() => Utils.cleanNaN('NaN')).to.not.throw();
    });
  });
});
