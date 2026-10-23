import { describe, expect, it } from "vitest";
import { validateFile, MAX_FILE_BYTES } from "./file-validation";

const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

describe("file validation", () => {
  it("accepts a real PDF", () => {
    expect(validateFile("a.pdf", "application/pdf", pdf)).toBeNull();
  });
  it("rejects files over 10 MB", () => {
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    big.set(pdf);
    expect(validateFile("a.pdf", "application/pdf", big)).toBe("File exceeds 10 MB limit");
  });
  it("rejects disallowed types such as executables", () => {
    expect(validateFile("a.exe", "application/x-msdownload", pdf)).toBe("File type not allowed");
  });
  it("rejects a spoofed PDF whose bytes are not PDF", () => {
    expect(validateFile("a.pdf", "application/pdf", new Uint8Array([1, 2, 3, 4]))).toBe(
      "File content is not a valid PDF",
    );
  });
  it("rejects mismatched extension", () => {
    expect(validateFile("a.html", "application/pdf", pdf)).toBe("File extension does not match its type");
  });
  it("rejects path traversal in names", () => {
    expect(validateFile("../a.pdf", "application/pdf", pdf)).toBe("Invalid file name");
  });
});
