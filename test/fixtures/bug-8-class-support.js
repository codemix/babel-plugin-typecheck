class Foo {
    bar(v : string) {
    }
}

export default function test () {
  const x = new Foo();
  x.bar("hello world");
}