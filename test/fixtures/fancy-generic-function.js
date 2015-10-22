export default function demo <T> (buffer: Buffer<T>, callback: (value: T) => number): number {
  return callback(buffer[0]);
}
