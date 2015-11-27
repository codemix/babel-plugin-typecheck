export default function demo (): string {
    return foo();
}

function foo (): string {
  return 'foo';
}

class Foo {
  constructor() {
    this.ret = '';
  }

  MyFunction(): string {
    return this.ret;
  }
}