class User {
  constructor (name) {
    this.name = name;
  }

  get length (): number {
    return this.name.length;
  }
}

export default function demo (name: string): string {
  const user = new User(name);
  return user.length;
}

