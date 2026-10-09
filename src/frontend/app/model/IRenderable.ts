export interface IRenderable {
  getDimension(): Dimension;
}

export interface Dimension {
  top: number;
  left: number;
  width: number;
  height: number;
}

export const DimensionUtils = {
  toString: (dim: Dimension) => {
    return {
      top: `${Number.isFinite(dim?.top) ? dim.top : 0}px`,
      left: `${Number.isFinite(dim?.left) ? dim.left : 0}px`,
      width: `${Number.isFinite(dim?.width) ? dim.width : 0}px`,
      height: `${Number.isFinite(dim?.height) ? dim.height : 0}px`,
    };
  },
};
