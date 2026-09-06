


const f = Math.fround;


export function applyMod(a: number, b: number): number {
  return b >= 0 ? f(f(1 + b) * a) : f(a / f(1 - b));
}
