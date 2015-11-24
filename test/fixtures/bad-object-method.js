type User = {
  name?: string;
  email?: string;
}



export default function demo (name, email): User {
  const user: User = {
    name: ("foo": string),
    email: ("bar@example.com": string),

    something (): User {
      this.name = 123;
      return this;
    }
  };

  return user.something();
}
