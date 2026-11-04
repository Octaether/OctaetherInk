import { defineConfig, type Plugin } from 'vite';

/**
 * The guide notes in sample/ are bundled as text, and the app saves notes into sample/ while it runs.
 * A saved note is data, not code: it must not reload the page, which would drop the open editor and the undo history.
 * The changed modules are still invalidated, so a manual reload picks the new text up.
 */
function noteNoReload(): Plugin {
	return {
		name: 'octaether-note-no-reload',
		apply: 'serve',
		hotUpdate: {
			// after Vite's own glob plugin, which adds the importing module when a note is created or deleted
			order: 'post',
			handler({ file, modules }) {
				if (!/[\\/]sample[\\/]/.test(file)) return;
				for (const module of modules) this.environment.moduleGraph.invalidateModule(module);
				return [];
			},
		},
	};
}

/**
 * Modules load their engines when first used (a Plot, a Table, a Calendar). The page names those
 * files as prefetch links, so the browser fetches them when idle and the service worker, which caches
 * every /assets/ file the page names, keeps them for offline use.
 */
function prefetchLazyChunk(): Plugin {
	return {
		name: 'octaether-prefetch-lazy-chunk',
		apply: 'build',
		transformIndexHtml: {
			order: 'post',
			handler(html, context) {
				if (!context.bundle) return html;
				const named = new Set([...html.matchAll(/\/assets\/[^"'()\s>]+/g)].map((match) => match[0]));
				const tagList = Object.values(context.bundle)
					.filter((item) => item.type === 'chunk' && !named.has(`/${item.fileName}`))
					.map((item) => ({ tag: 'link', attrs: { rel: 'prefetch', href: `/${item.fileName}`, as: 'script' }, injectTo: 'head' as const }));
				return { html, tags: tagList };
			},
		},
	};
}

export default defineConfig({
	plugins: [noteNoReload(), prefetchLazyChunk()],
	server: {
		port: 5173,
		// the sample vault lives at the repository root
		fs: { allow: ['../..'] },
	},
	build: {
		target: 'es2022',
		outDir: 'dist',
	},
});
