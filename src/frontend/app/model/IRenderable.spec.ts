import {describe, expect, it} from 'vitest';
import {DimensionUtils} from './IRenderable';

describe('DimensionUtils', () => {
  it('should format dimension values with px unit strings', () => {
    const dim = {
      top: 691,
      left: 432,
      width: 862,
      height: 284,
    };
    const styles = DimensionUtils.toString(dim);
    expect(styles).toEqual({
      top: '691px',
      left: '432px',
      width: '862px',
      height: '284px',
    });
  });

  it('should format zero values with 0px', () => {
    const dim = {
      top: 0,
      left: 0,
      width: 0,
      height: 0,
    };
    const styles = DimensionUtils.toString(dim);
    expect(styles).toEqual({
      top: '0px',
      left: '0px',
      width: '0px',
      height: '0px',
    });
  });

  it('should handle undefined or null properties safely', () => {
    const dim: any = {};
    const styles = DimensionUtils.toString(dim);
    expect(styles).toEqual({
      top: '0px',
      left: '0px',
      width: '0px',
      height: '0px',
    });
  });

  it('should handle NaN or infinite properties safely by defaulting to 0px', () => {
    const dim: any = {
      top: NaN,
      left: Infinity,
      width: -Infinity,
      height: undefined,
    };
    const styles = DimensionUtils.toString(dim);
    expect(styles).toEqual({
      top: '0px',
      left: '0px',
      width: '0px',
      height: '0px',
    });
  });
});

