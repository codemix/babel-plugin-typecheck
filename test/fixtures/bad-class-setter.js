class User {
  constructor (name) {
    this._name = name;
    this._called = false;
  }

  set name (name: string) {
    this._name = name;
  }

}

export default function demo (name): string {
  const user = new User('anonymous');
  user.name = null;
  return user.name;
}

