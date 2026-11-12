export function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

export function createRoutedFetch(routes) {
  return async (url, options = {}) => {
    const route = routes.find((r) => r.match(url, options));
    if (!route) throw new Error(`mockFetch: no route matched ${url}`);
    return route.respond(url, options);
  };
}

// A promise whose settlement the test controls.
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// A response whose headers arrived but whose body never finishes reading.
export function hangingFetchResponse(status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => new Promise(() => {}),
  };
}
