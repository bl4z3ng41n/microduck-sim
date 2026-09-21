import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// SvelteKit 3: kit options live here (no svelte.config.js).
export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Fully static output in build/ — every route is prerendered.
			adapter: adapter({ pages: 'build', assets: 'build', strict: true }),
			prerender: { entries: ['*'] }
		})
	],
	build: { chunkSizeWarningLimit: 2000 },
	optimizeDeps: { exclude: ['onnxruntime-web'] },
	server: { port: 5173 }
});
