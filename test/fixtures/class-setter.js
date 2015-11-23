class User {
  constructor (name) {
    this._name = name;
    this._called = false;
  }

  get name (): string {
    return this._name;
  }

  set name (name: string) {
    this._name = name;
  }

  set setterOnly (value: boolean) {
    this._called = value;
  }
}

export default function demo (name): string {
  const user = new User('anonymous');
  user.name = name;
  user.setterOnly = true;
  return user.name;
}

