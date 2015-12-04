export default function demo (headers) {
  const isid = true;
  headers = { 'x-user-isid': isid, ...headers };
  return headers;
}