// Octaether Ink service worker: after the first visit the app opens and works offline.
//   the page      network first, so a new version shows up at once; the cached copy when offline
//   /assets/*     cache first: built files have the hash of their content in their name
// Notes never pass through here: they live in your folder or in this browser's storage.

const cacheName = 'OctaetherInk-2';
const shellList = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png'];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(cacheName)
			.then((cache) => cache.addAll(shellList))
			.then(() => self.skipWaiting()),
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

/** Drops built files the new page no longer uses, so old versions don't pile up. */
async function prune(html) {
	const keepSet = new Set([...html.matchAll(/\/assets\/[^"'()\s>]+/g)].map((match) => match[0]));
	if (keepSet.size === 0) return;
	const cache = await caches.open(cacheName);
	for (const request of await cache.keys()) {
		const path = new URL(request.url).pathname;
		if (path.startsWith('/assets/') && !keepSet.has(path)) await cache.delete(request);
	}
}

async function page(request) {
	const cache = await caches.open(cacheName);
	try {
		const response = await fetch(request);
		if (response.ok) {
			await cache.put('/', response.clone());
			void response
				.clone()
				.text()
				.then(prune)
				.catch(() => undefined);
		}
		return response;
	} catch {
		return (await cache.match('/')) ?? Response.error();
	}
}

async function asset(request) {
	const cache = await caches.open(cacheName);
	const cached = await cache.match(request);
	if (cached) return cached;
	const response = await fetch(request);
	if (response.ok) await cache.put(request, response.clone());
	return response;
}

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;
	if (request.mode === 'navigate') event.respondWith(page(request));
	else if (url.pathname.startsWith('/assets/') || shellList.includes(url.pathname) || /^\/icon[\w-]*\.(?:png|svg)$/.test(url.pathname)) event.respondWith(asset(request));
});
