import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

// ponytail: formatting uses the installed ESLint fixer; no second formatter or bulk restyling.
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  {
    files: ['**/*.{js,ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'eol-last': ['error', 'always'],
      'no-trailing-spaces': 'error',
      'no-mixed-spaces-and-tabs': 'error',
      'semi': ['error', 'never'],
      'quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
    },
  },
)
