export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_TYPES: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "text/plain": ["txt", "md"],
  "text/csv": ["csv"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
};

function startsWith(bytes: Uint8Array, sig: number[]) {
  return sig.every((b, i) => bytes[i] === b);
}

/** Validates size, declared type, extension and magic bytes. Returns an error message or null. */
export function validateFile(fileName: string, mimeType: string, bytes: Uint8Array): string | null {
  if (bytes.length === 0) return "File is empty";
  if (bytes.length > MAX_FILE_BYTES) return "File exceeds 10 MB limit";
  const exts = ALLOWED_TYPES[mimeType];
  if (!exts) return "File type not allowed";
  if (/[\\/\0]/.test(fileName) || fileName.length > 200) return "Invalid file name";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!exts.includes(ext)) return "File extension does not match its type";

  const head = bytes.subarray(0, 8);
  switch (mimeType) {
    case "application/pdf":
      if (!startsWith(head, [0x25, 0x50, 0x44, 0x46])) return "File content is not a valid PDF";
      break;
    case "image/png":
      if (!startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return "File content is not a valid PNG";
      break;
    case "image/jpeg":
      if (!startsWith(head, [0xff, 0xd8, 0xff])) return "File content is not a valid JPEG";
      break;
    case "text/plain":
    case "text/csv":
      if (bytes.subarray(0, 4096).includes(0)) return "Text file contains binary content";
      break;
    default:
      if (!startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return "File content is not a valid Office document";
  }
  return null;
}

export function sanitizeText(s: string, max: number) {
  return s.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}
