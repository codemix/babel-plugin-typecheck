export default function demo <T> (input: T): T[] {
  const items = [];
  for (let item of gen(input)) {
    items.push(item);
  }
  return items;
}


function* gen (item): Generator<number, boolean> {
  yield 1;
  yield false;
  return true;
}