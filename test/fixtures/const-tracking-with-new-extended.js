class Person {}

class User extends Person {}

export default function demo (): Person {
  const result = new User;

  return result;
}