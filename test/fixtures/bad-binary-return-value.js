export default function demo (): string {
  if (Math.random() >= 0.5) {
    return "yes";
  }
  else if (Math.random() >= 0.5) {
    const str = "yes";
    return str;
  }
  else {
    return 1 > 2;
  }
}
