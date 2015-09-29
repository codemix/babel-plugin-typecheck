export default function demo (foo: string, bar: number = 1): boolean {
  return foo.length > 0 && bar > 0;
}