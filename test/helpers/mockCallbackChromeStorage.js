import { vi } from 'vitest';

export function createCallbackMockChromeStorage(initial = {}) {
  const data = { ...initial };
  return {
    get: vi.fn((keys, callback) => {
      let result = {};
      if (keys === null) {
        result = { ...data };
      } else {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const key of keyList) {
          if (key in data) result[key] = data[key];
        }
      }
      callback(result);
    }),
    set: vi.fn((values, callback) => {
      Object.assign(data, values);
      if (callback) callback();
    }),
    remove: vi.fn((keys, callback) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const key of keyList) delete data[key];
      if (callback) callback();
    }),
    _data: data,
  };
}
