class User {
  constructor (name: string) {
    this.name = name;
  }
}

export default function demo (name: string): any {
  let user: ?User;
  (() => {
    user = new User(name);
  })();
  return user;
}
