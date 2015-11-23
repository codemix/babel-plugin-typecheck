class Foo {
  method (): Foo {
    return this;
  }
}

export default function wat (): Foo {
  const foo = new Foo();

  return foo.method();
}