module.exports = [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      semi: ['error', 'always'],
      indent: ['error', 'tab'],
      'no-tabs': 'off',
      quotes: ['error', 'single'],
    },
  },
];