class User {
  name: string;
  email: string;
  age: number;

  constructor (name, email, age = 123) {
    this.name = name;
    this.email = email;
    this.age = age;
  }
  method (input: string|boolean, extra: false): User {
    return this;
  }
}

export default function demo (name, email): User {
  const user = new User(name, email);
  return user.method('str', false);
}