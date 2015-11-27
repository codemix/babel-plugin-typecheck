export default function demo <T> (input: T): T[] {
  const items = [];
  const it = gen();
  let next;
  while (!(next = it.next(input)).done) {
    let yieldedValue = next.value;
    items.push(yieldedValue);
  }
  return items;
}


function* gen (): Generator<number, boolean, number> {
  let last: number = 0;
  last = yield 1;
  last = yield 2 + last;
  last = yield 3 + last;
  return true;
}