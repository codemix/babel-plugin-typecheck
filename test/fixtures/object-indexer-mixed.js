type Thing = {
  bool: boolean;
  bools: boolean[];
  [key: string]: string|number
};

export default function demo (key, value): Thing {
  const thing: Thing = {
    bool: true,
    bools: [true, false],
    string: "hello world",
    number: 123
  };
  thing[key] = value;
  return thing;
}
