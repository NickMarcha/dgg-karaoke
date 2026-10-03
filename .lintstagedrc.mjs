export default {
  '*.{mjs,ts,tsx}': ['oxfmt --config ./.oxfmtrc.ci.js', 'oxlint --fix-dangerously'],
  '*.{ts,tsx}': () => 'pnpm type-check',
  'src/**/*.{ts,tsx}': () => 'pnpm test:staged',
  // The API is its own package, outside the root type-check and test run.
  'server/**/*.ts': () => ['npm --prefix server run type-check', 'npm --prefix server test'],
  '{package.json,knip.json,{src,tests,scripts}/**/*.{ts,tsx,js,mjs}}': () => 'pnpm knip',
};
