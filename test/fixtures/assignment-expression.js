export default function demo (input: Array) {
  let items: Array = input;
  items = [1,2,3];

  ((items = 456): number);
  items = 123;
}
