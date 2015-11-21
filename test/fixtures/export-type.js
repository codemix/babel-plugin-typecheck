export type User = {
  name: string,
  age: number
};

export type UserCollection = User[];

export const wat = 123;

export default function demo (input: User): User {
  const saved = input;
  return saved;
}

const wat2 = 321;
export {wat2};
