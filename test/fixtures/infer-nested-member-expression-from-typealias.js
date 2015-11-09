export type User = {
  name: string;
  location: Location;
};

export type Location = {
  address: string;
}

//export type address = string;

export default function demo (input: User): string {
  return input.location.address;
}