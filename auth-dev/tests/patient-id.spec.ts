import { test, expect } from "@playwright/test";
import { createPatientId } from "../patient-id";

test("patient IDs work without secure-context randomUUID", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, "randomUUID");
  Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: undefined });
  try {
    const ids = Array.from({ length: 100 }, () => createPatientId());
    expect(new Set(ids).size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis.crypto, "randomUUID", descriptor);
    else Reflect.deleteProperty(globalThis.crypto, "randomUUID");
  }
});
