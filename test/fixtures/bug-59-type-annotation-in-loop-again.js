type Type = number;

export default function demo (): number {
  let foo: Array<string|Type> = ['foo', 123, 'bar', 456];

  for (let bar: string|Type of foo) {
      // ...
  }

  return 123;
}