// Serves static assets; any page navigation that misses (e.g. Archive IDs containing dots,
// which look like file names) falls back to the app shell so the client router can take over.
export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(request);
    const wantsPage = request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html');
    if (res.status === 404 && wantsPage) {
      const shell = await env.ASSETS.fetch(new Request(new URL('/', request.url), request));
      return new Response(shell.body, { status: 200, headers: shell.headers });
    }
    return res;
  },
};
