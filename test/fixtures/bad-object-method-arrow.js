type User = {
  name?: string;
  email?: string;
}



export default function demo (name, email): string {
  const user: User = {
    name: ("foo": string),
    email: ("bar@example.com": string),

    something (): User {
      this.name = name;
      return this;
    },

    other: function (): string {
      const foo = () => {
        this.email = {};
        return 'foo';
      };
      return foo();
    }
  };

  return user.something().other();
}
