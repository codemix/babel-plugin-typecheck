export default function demo (input: Iterable<number>): number {
  let total = 0;
  for (let item: string of input) {
    total += item;
  }
  return total;
}