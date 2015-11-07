export type User = {
  name: string;
  location: Location;
};

export type Location = {
  address: string;
}

export default function demo (input: User): number {
  return input.location.address;
}