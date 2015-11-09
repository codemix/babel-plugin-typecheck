type User = {
  name: string;
};

const user: User = {
  name: 'bob'
};

export default function demo (input: typeof user): string {
  return input.name;
}