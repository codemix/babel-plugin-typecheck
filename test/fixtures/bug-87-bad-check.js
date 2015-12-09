export default function demo (input) {
  let foo;

  if (input.yes) {
    foo = true;
  }
  else {
    foo = false;
  }

  input.result = foo;

  return input;
}
