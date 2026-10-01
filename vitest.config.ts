import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['{core,module,plugin,app}/*/test/**/*.test.ts'],
		environment: 'node',
	},
});
