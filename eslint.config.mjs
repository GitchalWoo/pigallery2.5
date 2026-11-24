// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import angular from "angular-eslint";
import chaiFriendly from 'eslint-plugin-chai-friendly';

export default tseslint.config(
  {
    files: ["src/frontend/*.ts"],
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
    },
  },
  {
    files: ["src/frontend/*.html"],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {},
  },
  {
    // The blocks above match only top-level files (Techdebt T8); this rule checks every template
    files: ["src/frontend/**/*.html"],
    extends: [
      angular.configs.templateRecommended[0],
    ],
    rules: {
      // a button without a type submits its form: the Enter key in any field of the form clicks the first one
      "@angular-eslint/template/button-has-type": "error",
    },
  },
  {
    files: ["src/common/*.ts", "src/backend/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
    ],
    rules: {
      '@typescript-eslint/prefer-for-of': 'off'
    }
  },
  {
    files: ["test/*.ts"],
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
);
