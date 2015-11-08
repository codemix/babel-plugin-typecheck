export type User = {
  name: string;
};

export default function demo (input: User): string {
  let output = {
    name: "test",
    address: "123 Fake Street"
  };
  return output.name;
}