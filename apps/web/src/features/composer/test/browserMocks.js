import { vi } from 'vitest';

/**
 * jsdom lacks URL.createObjectURL / revokeObjectURL, DataTransfer and media decoding.
 * These helpers stand in for them in tests only. Call them in `beforeEach`.
 */

/** Stubs object URLs. Returns `{ created, revoked, restore }`. */
export function installObjectUrlMock() {
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const created = [];
  const revoked = [];
  let n = 0;
  URL.createObjectURL = vi.fn((blob) => {
    n += 1;
    const url = `blob:mock/${n}-${blob?.name ?? 'blob'}`;
    created.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url) => {
    revoked.push(url);
  });
  return {
    created,
    revoked,
    restore() {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
    },
  };
}

/**
 * A File whose reported `size` can be large without allocating that much memory.
 * `makeFile('a.jpg', 'image/jpeg', 2 * 1024 * 1024)`.
 */
export function makeFile(name, type, size = 1024) {
  const file = new File([new Uint8Array(Math.min(size, 16))], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

/** Minimal DataTransfer-like object for fireEvent.drop / dragEnter in jsdom. */
export function dataTransferWith(files) {
  return {
    files,
    items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    types: ['Files'],
    dropEffect: 'none',
    effectAllowed: 'all',
  };
}
