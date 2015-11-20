type User = {
  name: string;
}

export const user: User = {name: 'foo'};

export default function demo (input: string): number {
  return input.length;
}