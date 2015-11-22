export class Thing {
  constructor (name: string) {
    this.name = name;
  }

  async go (age: number): [string, number] {
    return [this.name, age];
  }
}

export default async function demo (input: string[]): [string, number] {
  const thing = new Thing(input[0]);
  const result = await thing.go(88);
  return result;
}
