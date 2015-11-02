type Blob = Buffer;
type integer = number;
type str = string;
type strOrNumber = string|number;
type arr = Array<string,integer,Blob>;
type strings = Array<string|number|Blob|Buffer>;
type obj = {
  name: string,
  age: number,
  location: {
    city: arr,
    wat: mixed,
    qux: any,
    blub: Function
  }
};
export default function demo <T>(value: T, extra: string, wat: {foo: string, bar: number|Array<string>}): T|string {
  const someValue: string = "123";
  return value + someValue;
}
