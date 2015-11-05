export default function demo (input: Array): string {
  let items: Array = input;
  items = [1, 2, 3];
  items = [4, 5, 6];
  items = makeArray();
  ((items = 456): number);
  items = 123;
  (items: string);
  items = "wat";
  items = makeString();

  items = "foo";

  return items;
}


function makeArray (): Array {
  return [7, 8, 9];
}

function makeString (): string {
  return "foo bar";
}