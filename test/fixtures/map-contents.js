export default function demo (input: Map<string, number>): Map<number, string> {
  const converted = new Map();
  for (let [key, value] of input) {
    converted.set(value, key);
  }
  return converted;
}