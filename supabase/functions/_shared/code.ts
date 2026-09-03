export function generateNumericCode(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < length; i++) code += (bytes[i] % 10).toString();
  return code;
}
