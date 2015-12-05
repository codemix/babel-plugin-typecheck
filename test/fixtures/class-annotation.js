export default function demo (input: Class): Class {
  input.prototype.foo = () => 'bar';
  return input;
}