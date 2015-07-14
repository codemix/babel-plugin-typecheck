class X {
  add (x: number, y: number): number {
    return x + y;
  }
}

export default function test () {
  const x = new X();
  return x.add(12, 23);
}