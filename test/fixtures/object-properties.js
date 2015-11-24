type User = {
  name?: string;
  email?: string;
}



export default function demo (name, email): User {
  const user = createUser();
  user.name = name;
  user.email = email;
  return user;
}

function createUser (): User {
  return {};
}