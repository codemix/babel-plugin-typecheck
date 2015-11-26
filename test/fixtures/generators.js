export default function demo <T> (input: T): T[] {
  const items = [];
  for (let item of gen(input)) {
    items.push(item);
  }
  return items;
}


function* gen (item): Generator<number|string, boolean> {
  yield 1;
  yield 2;
  yield 3;
  yield item;
  return true;
}