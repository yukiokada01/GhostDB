const encoder = new TextEncoder();
const decoder = new TextDecoder();

function hexToBytes(hexValue: string): Uint8Array {
  const cleanHex = hexValue.replace(/^0x/, "");
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(accessKey: string) {
  const keyBytes = hexToBytes(accessKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", keyBytes);
  return crypto.subtle.importKey("raw", hashBuffer, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptBody(plainText: string, accessKey: string): Promise<string> {
  const key = await deriveKey(accessKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plainText));

  const combined = new Uint8Array(iv.length + cipherBuffer.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(cipherBuffer), iv.length);

  return bytesToBase64(combined);
}

export async function decryptBody(cipherText: string, accessKey: string): Promise<string> {
  const key = await deriveKey(accessKey);
  const combined = base64ToBytes(cipherText);
  const iv = combined.slice(0, 12);
  const payload = combined.slice(12);

  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, payload);
  return decoder.decode(plainBuffer);
}

export function shortHex(value: string, visible = 6): string {
  if (!value) return "";
  return `${value.slice(0, visible)}...${value.slice(-visible)}`;
}
