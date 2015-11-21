class User {
  constructor (name) {
    this.name = name;
  }

  get length (): number {
    return this.name.length;
  }

  get minusLength (): number {
    return -this.length;
  }
}

export default function demo (name: string): number {
  const user = new User(name);
  return user.length;
}

