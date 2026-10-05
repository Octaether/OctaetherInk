// Octaether Ink service worker: after the first visit the app opens at once, and works offline.
//   the page      from the cache at once, never waiting on the network (a slow or stalled
//                 connection used to leave the page blank until a reload). Meanwhile the
//                 network's copy is fetched with every file it needs and replaces the cached
//                 one; open pages then hear "Updated" and offer Reload.
//   /assets/*     cache first: built files have the hash of their content in their name. The
//                 files of the cached page and of the one before it are kept (a tab may still
//                 run that one); older ones are dropped.
// Notes never pass through here: they live in your folder or in this browser's storage.

const cacheName = 'OctaetherInk-3';
const shellList = ['/manifest.webmanifest', '/icon.svg', '/icon-192.png'];
const pageKey = '/';
const previousKey = '/previous-page';

/** The built files a page loads (/assets/…), in order. */
function assetListOf(html) {
	return [...new Set([...html.matchAll(/\/assets\/[^"'()\s>]+/g)].map((match) => match[0]))];
}

/**
 * Fetches the page with every file it needs, then makes it the cached page. Resolves to the
 * network's response (undefined offline) and whether it is a new version.
 */
async function refresh() {
	const cache = await caches.open(cacheName);
	let response;
	try {
		response = await fetch(pageKey, { cache: 'no-cache' });
	} catch {
		return { response: undefined, updated: false };
	}
	if (!response.ok) return { response, updated: false };
	const html = await response.clone().text();
	const assetList = assetListOf(html);
	// its files first: a cached page whose script is missing would not open offline
	for (const path of assetList) {
		if (await cache.match(path)) continue;
		const asset = await fetch(path).catch(() => undefined);
		if (!asset?.ok) return { response, updated: false };
		await cache.put(path, asset);
	}
	const old = await cache.match(pageKey);
	const oldHtml = old ? await old.text() : undefined;
	const updated = oldHtml !== undefined && assetListOf(oldHtml).join() !== assetList.join();
	if (updated) await cache.put(previousKey, new Response(oldHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
	await cache.put(pageKey, response.clone());
	await prune(cache);
	return { response, updated };
}

/** Drops built files that neither the cached page nor the one before it uses. */
async function prune(cache) {
	const keepSet = new Set();
	for (const key of [pageKey, previousKey]) {
		const page = await cache.match(key);
		if (page) for (const path of assetListOf(await page.text())) keepSet.add(path);
	}
	if (keepSet.size === 0) return;
	for (const request of await cache.keys()) {
		const path = new URL(request.url).pathname;
		if (path.startsWith('/assets/') && !keepSet.has(path)) await cache.delete(request);
	}
}

async function tellUpdated() {
	for (const client of await self.clients.matchAll({ type: 'window' })) client.postMessage({ type: 'Updated' });
}

async function page(event) {
	const cache = await caches.open(cacheName);
	const cached = await cache.match(pageKey);
	const update = refresh().then(async ({ response, updated }) => {
		if (updated) await tellUpdated();
		return response;
	});
	if (cached) {
		event.waitUntil(update.catch(() => undefined));
		return cached;
	}
	// nothing cached yet: the network, as on a first visit
	return (await update.catch(() => undefined)) ?? Response.error();
}

async function asset(request) {
	const cache = await caches.open(cacheName);
	const cached = await cache.match(request);
	if (cached) return cached;
	const response = await fetch(request);
	if (response.ok) await cache.put(request, response.clone());
	return response;
}

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(cacheName);
			await cache.addAll(shellList);
			// the page and its files now, so the app opens offline after the first visit
			await refresh();
			await self.skipWaiting();
		})(),
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keyList) => Promise.all(keyList.filter((key) => key !== cacheName).map((key) => caches.delete(key))))
			.then(() => self.clients.claim()),
	);
});

// a page says which script it runs; when the cached page is newer, it hears "Updated"
self.addEventListener('message', (event) => {
	if (event.data?.type !== 'Version' || typeof event.data.script !== 'string') return;
	event.waitUntil(
		(async () => {
			const cached = await (await caches.open(cacheName)).match(pageKey);
			if (!cached) return;
			const script = new URL(event.data.script, self.location.origin).pathname;
			if (!assetListOf(await cached.text()).includes(script)) event.source?.postMessage({ type: 'Updated' });
		})(),
	);
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;
	if (request.mode === 'navigate') event.respondWith(page(event));
	else if (url.pathname.startsWith('/assets/') || shellList.includes(url.pathname) || /^\/icon[\w-]*\.(?:png|svg)$/.test(url.pathname)) event.respondWith(asset(request));
});
