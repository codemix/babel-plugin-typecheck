export default function demo (input: Set<number>): number {
  let total = 0;
  for (let item of input) {
    total += item;
  }
  return total;
}