export function createMockChromeStorage(initial = {}) {
  const data = { ...initial };
  const local = {
    get: async (keys) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      const result = {};
      for (const key of keyList) {
        if (key in data) result[key] = data[key];
      }
      return result;
    },
    set: async (values) => {
      Object.assign(data, values);
    },
    remove: async (keys) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const key of keyList) delete data[key];
    },
  };
  return { local, _data: data };
}
