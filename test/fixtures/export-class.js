export class User {}

export type UserCollection = User[];

export default function demo (input: User): UserCollection {
  const saved = input;
  return [saved];
}
