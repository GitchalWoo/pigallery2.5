// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import angular from "angular-eslint";
import chaiFriendly from 'eslint-plugin-chai-friendly';

// The keyboard and screen reader rules of templateAccessibility: warnings until the
// clickable elements are made keyboard accessible (Techdebt T8, accessibility PR)
const accessibilityWarnings = {
  "@angular-eslint/template/click-events-have-key-events": "warn",
  "@angular-eslint/template/interactive-supports-focus": "warn",
  "@angular-eslint/template/mouse-events-have-key-events": "warn",
  "@angular-eslint/template/label-has-associated-control": "warn",
  "@angular-eslint/template/alt-text": "warn",
  "@angular-eslint/template/elements-content": "warn",
};

export default tseslint.config(
  {
    files: ["src/frontend/**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      "@angular-eslint/directive-selector": [
        "error",
        {
          type: "attribute",
          prefix: "app",
          style: "camelCase",
        },
      ],
      "@angular-eslint/component-selector": [
        "error",
        {
          type: "element",
          prefix: "app",
          style: "kebab-case",
        },
      ],
      // the fork keeps constructor injection (AGENTS.md: no migration to inject()/signals)
      "@angular-eslint/prefer-inject": "off",
      // the fork keeps ChangeDetectionStrategy.Eager for async RxJS, media and router updates (AGENTS.md)
      "@angular-eslint/prefer-on-push-component-change-detection": "off",
    },
  },
  {
    files: ["src/frontend/**/*.html"],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {
      // `x == null` is the usual check for null and undefined
      "@angular-eslint/template/eqeqeq": ["error", {allowNullOrUndefined: true}],
      // a button without a type submits its form: the Enter key in any field of the form clicks the first one
      "@angular-eslint/template/button-has-type": "error",
      ...accessibilityWarnings,
    },
  },
  {
    files: ["src/common/**/*.ts", "src/backend/**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
    ],
    rules: {
      '@typescript-eslint/prefer-for-of': 'off',
      // the jobs override abstract getters (Name, Supported, ...); fields would change when they are set
      '@typescript-eslint/class-literal-property-style': 'off',
    }
  },
  {
    files: ["test/**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
    ],
    plugins: {
      'chai-friendly': chaiFriendly
    },
    rules: {
      // turn off the strict TS version
      '@typescript-eslint/no-unused-expressions': 'off',
      // and enable the chai-friendly version
      'chai-friendly/no-unused-expressions': 'error'
    }
  },
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    rules: {
      // CommonJS backend: native modules are loaded lazily, extensions and fixtures from runtime paths
      '@typescript-eslint/no-require-imports': 'off',
      // the remaining explicit any are cleaned up after the upstream ports (Techdebt T8)
      '@typescript-eslint/no-explicit-any': 'warn',
      // `_` marks an intentionally unused name, and `const {a, ...rest} = x` may drop `a`.
      // Last, so the presets above don't reset the options.
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      }],
    },
  },
);
