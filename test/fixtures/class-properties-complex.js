type Location = {
  address: string;
  country: CountryCode;
  pos: GeoPoint;
};

type CountryCode = "GB" | "US" | "FR" | "CA"; // Sorry everyone else!

type GeoPoint = {
  lat: number;
  lon: number;
}
class Thing {
  name: string;
  go (age: number): [string, number] {
    return [this.name, age];
  }
}

class User {
  name: string;
  email: string;
  age: number;
  location: Location;

  constructor (name, email, age = 123) {
    this.name = name;
    this.email = email;
    this.age = age;
  }
  method (input: string|boolean, extra: false): User {
    return this;
  }
  setLocation (input): User {
    this.location = input;
    return this;
  }
}

export default function demo (name: string, email: string, location: Object, country): User {
  const user = new User(name, email);
  user.setLocation(location);
  user.location.country = country;
  user.nope = 123;
  return user.method('str', false);
}