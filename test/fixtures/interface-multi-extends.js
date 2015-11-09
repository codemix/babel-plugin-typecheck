interface Thing {
  name: string;
};
interface Person {
  age: number;
};

interface User extends Thing, Person {
  isActive: boolean;
}

export default function demo (input: User): User {
  return input;
}
