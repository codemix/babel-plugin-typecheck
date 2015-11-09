class User {
  constructor (name: string) {
    this.name = name;
  }
}

const user: User = new User('bob');

export default function demo (input: string|boolean): typeof user {
  return typeof input === 'string' ? create(input) : nope("nope");
}


function create (name: string) {
  return new User(name);
}

function nope (name: string) {
  return name;
}