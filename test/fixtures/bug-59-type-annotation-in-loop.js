export default function demo (): number {
  let foo: Array<string> = [];
  let total = 0;
  for (let bar: string of foo) {
    total += foo.length;
  }
  for (let bar: string of foo)
    total += foo.length;

  for (let i: number = 0, blah: string = ["a", "b", "c"].join(); i < foo.length; i++) {
    total += foo.length;
  }

  for (let prop: string in demo) {
    total += prop.length;
  }
  return total;
}