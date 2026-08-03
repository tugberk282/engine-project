export const MAX_VIEWPORT_PIXEL_RATIO = 2;

export type ViewportSize = {
    width: number;
    height: number;
    pixelRatio: number;
};

export function calculateViewportSize(
    width: number,
    height: number,
    devicePixelRatio: number,
    maxPixelRatio = MAX_VIEWPORT_PIXEL_RATIO
): ViewportSize | null {
    const cssWidth = Math.floor(width);
    const cssHeight = Math.floor(height);
    if (cssWidth < 1 || cssHeight < 1) return null;

    const finiteRatio = Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
    return {
        width: cssWidth,
        height: cssHeight,
        pixelRatio: Math.min(Math.max(finiteRatio, 1), maxPixelRatio)
    };
}

export function viewportSizeEquals(left: ViewportSize | null, right: ViewportSize): boolean {
    return left !== null
        && left.width === right.width
        && left.height === right.height
        && left.pixelRatio === right.pixelRatio;
}
