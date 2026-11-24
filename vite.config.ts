import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(async ({ command, mode }) => {
  const plugins: PluginOption[] = [react()];
  const localStack = command === 'serve' && mode === 'local-stack';
  if (localStack) {
    // Dev-only Auth/Storage stand-in; imported here so it never reaches the production bundle.
    const { supabaseStub } = await import('./dev/supabase-stub');
    plugins.push(supabaseStub());
  }
  const restProxy = {
    '/rest/v1': {
      target: 'http://127.0.0.1:54331',
      rewrite: (path: string) => path.replace(/^\/rest\/v1/, ''),
    },
  };
  return {
    plugins,
    preview: localStack ? { proxy: restProxy } : undefined,
    server: localStack
      ? {
          // Test artefacts, local storage and ledgers change constantly: never reload the app for them.
          watch: { ignored: ['**/test-results/**', '**/playwright-report/**', '**/.local/**', '**/.superpowers/**', '**/docs/**'] },
          proxy: restProxy,
        }
      : undefined,
    build: {
      sourcemap: true,
      rolldownOptions: {
        output: {
          // Long-lived vendor chunks: app updates do not invalidate the React or Supabase code.
          codeSplitting: {
            groups: [
              { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
              { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/ },
            ],
          },
        },
      },
    },
  };
});
