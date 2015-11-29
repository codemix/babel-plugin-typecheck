const got = [];

class Foo {
  constructor() {
    this.foo = ["a", "b", "c"];
  }

  myFunction(): void {
    for (let f: string of this.foo) {
      got.push(f);
    }
  }
}

export default function demo (): string[] {
  const foo = new Foo ();
  foo.myFunction();
  return got;
}