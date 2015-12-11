type Thing = {
  [key: string]: string|number
};

export default function demo (key, value): Thing {
  const thing: Thing = {
    string: "hello world",
    number: 123
  };
  thing[key] = value;
  return thing;
}
