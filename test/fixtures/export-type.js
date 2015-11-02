export type User = {
  name: string,
  age: number
};

export const wat = 123;

export default function demo (input: User): User {
  const saved = input;
  return saved;
}