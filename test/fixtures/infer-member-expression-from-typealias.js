export type User = {
  name: string;
};

export default function demo (input: User): string {
  return input.name;
}