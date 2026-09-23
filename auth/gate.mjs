// Page gate only. Every Node API verifies identity independently; Cortos also
// verifies identity in Cloud Run. Client middleware headers grant no access.
export async function pageGate(request, fetcher = fetch) {
  const url = new URL(request.url);
  const login = new URL('/login/', url);
  login.searchParams.set('next', url.pathname.startsWith('/cortos') ? '/cortos/' : '/');
  const redirect = () => new Response(null, { status: 303, headers: { Location: login.href, 'Cache-Control': 'private, no-store' } });
  if (!request.headers.get('cookie')?.includes('__Host-studio_session=')) return redirect();
  try {
    const response = await fetcher(new URL('/api/health?studioAuth=status', url), {
      headers: { cookie: request.headers.get('cookie') }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return redirect();
    return new Response(null, { headers: { 'x-middleware-next': '1', 'Cache-Control': 'private, no-store' } });
  } catch { return redirect(); }
}
