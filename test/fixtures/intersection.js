type Nameable = {
  name: string;
};

type Locatable = {
  address: string;
};

export default function demo (input: Nameable & Locatable): string {
  return `${input.name} ${input.address}`;
}