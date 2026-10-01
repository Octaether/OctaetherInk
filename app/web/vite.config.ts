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

export default defineConfig({
	plugins: [noteNoReload()],
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
