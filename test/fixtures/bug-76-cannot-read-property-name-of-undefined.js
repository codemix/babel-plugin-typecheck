class Bar {

}

class Foo {
  _bar: Bar;

  constructor() {
    this._bar = new Bar();
  }

  setBar(): void {
    let bar: ?Bar = null;

    if (bar != null) {
      this._bar = bar;
    }
  }
}



export default function demo (): Bar {
  const foo = new Foo();
  foo.setBar();
  return foo._bar;
}