export class Thing <T> {
  constructor (input: T) {
    this.input = input;
  }

  get (): T {
    return this.input;
  }

  foo (): string {
    return "123";
  }
}


export default function demo <Z> (input: Z): [Z, string] {
  const instance = new Thing(input);
  return [instance.get(), instance.foo()];
}