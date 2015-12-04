export default function demo (headers) {
  const isid = true;
  const foo: {a: string;} = {a: "123"};
  const container = {
    headers: {},
    something: "else",

    method (): string {
      return this.something;
    }
  }
  container.headers = { 'x-user-isid': isid, ...foo, ...headers };
  return container;
}