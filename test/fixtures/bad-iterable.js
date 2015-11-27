export default function demo (input: number): number {
  let total = 0;
  for (let item: string of input) {
    total += item;
  }
  return total;
}