import { playwright } from '@vitest/browser-playwright';
import babel from '@rolldown/plugin-babel';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import * as process from 'process';
import { visualizer } from 'rollup-plugin-visualizer';
import { configDefaults, defineConfig } from 'vitest/config';
import { bundledIcons } from './scripts/vite-plugin-bundled-icons';
import routePaths from './src/routes/route-paths';
import { htmlPrerender } from './vite-plugin-html-prerender/src/index';

// HTTPS is opt-in (`pnpm start:https`). Plain `http://localhost` is already a secure context, so the
// Service Worker and getUserMedia work by default - HTTPS is only needed to reach the dev server from
// another device on the LAN (eg. a phone used as a remote mic). See readme.md.
const useHttps = !!process.env.HTTPS;
const certPath = './config/crt/server.pem';
const keyPath = './config/crt/server.key';
const customCert = fs.existsSync(certPath);

if (useHttps && !customCert) {
  console.log(
    'No custom cert found, the browser will warn about the certificate. Check config/crt/readme.md how to fix it',
  );
}

// Online mode needs a Cloudflare Realtime SFU, and a checkout has no Realtime app. So the Worker's
// Realtime calls are pointed at the fake SFU in tests/fake-sfu, with placeholder credentials, in two
// cases - never on a build that gets deployed:
// - the end-to-end suite (`E2E_FAKE_SFU_URL`: `pnpm start:e2e`, and CI's e2e build), which starts the
//   fake itself and keeps its Durable Object storage and dep cache apart from a regular `pnpm start`;
// - the dev server, when `.dev.vars` holds no Realtime credentials: the fake is started alongside it.
// The signaling rate limiter goes in both: every page of the suite, or every tab a developer opens to
// play against themselves, shares one local IP, far past the budget sized for one real browser.
// https://vitejs.dev/config/
export default defineConfig({
  // experimental: {
  // bundledDev: true,
  // },
  resolve: {
    tsconfigPaths: true, // Tells Vite to read paths from tsconfig.json
  },
  plugins: [
    bundledIcons({ namesFile: path.resolve(__dirname, 'src/modules/elements/akui/icon-names.ts') }),
    react({
      jsxImportSource: process.env.NODE_ENV === 'development' ? '@welldone-software/why-did-you-render' : undefined,
    }),
    babel({
      presets: [reactCompilerPreset()],
      plugins: [
        '@emotion/babel-plugin',
        // https://mui.com/material-ui/guides/minimizing-bundle-size/
        [
          'babel-plugin-transform-imports',
          {
            '@mui/icons-material': {
              transform: '@mui/icons-material/${member}',
              preventFullImport: true,
            },
            '@mui/material': {
              transform: '@mui/material/${member}',
              preventFullImport: true,
            },
          },
        ],
      ],
    }),
    visualizer(),
    useHttps && !customCert && basicSsl(),

    process.env.VITE_APP_PRERENDER
      ? htmlPrerender({
          staticDir: path.join(__dirname, 'build'),
          // The admin page has no screen until our API serves it (docs/plans/dgg-karaoke.md)
          routes: Object.values(routePaths)
            .filter((route) => route !== 'admin')
            .map((route) => `/${route}`),
          minify: {
            collapseBooleanAttributes: true,
            collapseWhitespace: true,
            decodeEntities: true,
            keepClosingSlash: true,
            sortAttributes: true,
          },
        })
      : null,
  ],
  base: '/',
  // The same for the dep cache — two dev servers optimising into one directory trample each other.
  build: {
    outDir: 'build',
    sourcemap: !process.env.FAST_BUILD,
    reportCompressedSize: !process.env.FAST_BUILD,
  },
  server: {
    port: 3000,
    open: false,
    // HTTPS mode exists to reach the dev server from another device, so expose it on the LAN as well
    host: useHttps,
    ...(useHttps
      ? {
          https: {
            // Generated via https://letsencrypt.org/docs/certificates-for-localhost/#making-and-trusting-your-own-certificates
            key: fs.readFileSync(customCert ? keyPath : './config/crt/dummy.key'),
            cert: fs.readFileSync(customCert ? certPath : './config/crt/dummy.pem'),
          },
        }
      : {}),
  },
  preview: {
    open: false,
  },

  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          environment: 'happy-dom',
          name: 'app',
          setupFiles: 'src/setup-tests.ts',
          include: ['**/*.test.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
          exclude: [...configDefaults.exclude, '**/*.browser.test.{ts,tsx}', 'server/**/*', '.claude/**/*'],
        },
      },
      {
        extends: true,
        // Imported dynamically, so the optimizer only discovers it mid-run and reloads the page under the test
        optimizeDeps: { include: ['aubiojs'] },
        test: {
          name: 'browser',
          setupFiles: 'src/setup-tests.browser.ts',
          include: ['src/**/*.browser.test.{ts,tsx}'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: {
                args: [
                  '--no-sandbox',
                  '--font-render-hinting=none', // https://github.com/microsoft/playwright/issues/20097
                  '--mute-audio',
                  '--allow-file-access-from-files',
                  '--use-fake-ui-for-media-stream',
                  '--use-fake-device-for-media-stream',
                  '--use-file-for-fake-audio-capture=tests/fixtures/test-440hz.wav',
                  ...(process.env.CI ? [] : ['--use-gl=egl']),
                ],
              },
            }),
            instances: [{ browser: 'chromium' }],
            locators: {
              testIdAttribute: 'data-test',
            },
            expect: {
              toMatchScreenshot: {
                // Keeps the layout the Playwright CT suite used: one shared root directory, split per test
                // file, and `-ci` references for the Linux CI container vs. per-platform ones locally
                resolveScreenshotPath: ({ arg, ext, root, testFileDirectory, testFileName }) =>
                  path.join(
                    root,
                    '__snapshots__',
                    path.relative('src', testFileDirectory),
                    testFileName,
                    `${arg}${process.env.CI ? '-ci' : `-${process.platform}`}${ext}`,
                  ),
              },
            },
          },
        },
      },
    ],
  },
});
