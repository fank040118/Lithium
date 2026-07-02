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
