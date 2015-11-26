
export default function demo ({a, b: c, d: {e: f, g: h}}: {a: string; b: number; d: {e: string; g: number}}): string {
  return f;
}
