interface Thing {
  name: string;
};
interface Person {
  age: number;
};


class User implements Thing, Person {
  constructor (input: Object) {
    this.input = input;
  }
}

export default function demo (input: Object): User {
  return new User(input);
}
