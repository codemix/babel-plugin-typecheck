interface Thing {
  name: string;
};

interface User extends Thing {
  age: number;
}

export default function demo (input: User): User {
  return input;
}