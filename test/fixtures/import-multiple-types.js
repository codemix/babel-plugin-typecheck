import type {User, UserCollection} from "./export-type";

export default function demo (users: UserCollection): User {
  return users[0];
}