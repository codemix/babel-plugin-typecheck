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

  myFunction2(): void {
    for (f of this.foo) {
      got.push(f);
    }
    var f;
  }
}

export default function demo (): string[] {
  const foo = new Foo ();
  foo.myFunction();
  foo.myFunction2();
  return got;
}