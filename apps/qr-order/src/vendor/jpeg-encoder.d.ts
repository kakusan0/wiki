/** RGBA の画素から、ベースライン JPEG（4:4:4）を作る */
export default function encode(img: { data: Uint8Array | Uint8ClampedArray; width: number; height: number }, quality?: number): { data: Uint8Array<ArrayBuffer>; width: number; height: number };
