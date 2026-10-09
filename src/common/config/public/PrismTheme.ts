/* Built-in palette shared by configuration defaults and existing installations. */
export const PRISM_THEME = `
:root {
  --bs-primary: #6550df;
  --bs-primary-rgb: 101, 80, 223;
  --bs-body-bg: #f5f3fa;
  --bs-body-bg-rgb: 245, 243, 250;
  --bs-body-color: #252236;
  --bs-body-color-rgb: 37, 34, 54;
  --bs-emphasis-color: #191526;
  --bs-secondary-color: #666078;
  --bs-secondary-bg: #eae6f2;
  --bs-tertiary-bg: #eeebf5;
  --bs-border-color: #ddd8e9;
  --bs-link-color: #6550df;
  --bs-link-color-rgb: 101, 80, 223;
  --bs-link-hover-color: #4936b4;
  --bs-link-hover-color-rgb: 73, 54, 180;
  --pg-surface: #fdfcff;
  --pg-soft: #eeebf5;
}
:root[data-bs-theme=dark] {
  --bs-primary: #b7a9ff;
  --bs-primary-rgb: 183, 169, 255;
  --bs-body-bg: #121119;
  --bs-body-bg-rgb: 18, 17, 25;
  --bs-body-color: #eeeaf7;
  --bs-body-color-rgb: 238, 234, 247;
  --bs-emphasis-color: #faf8ff;
  --bs-secondary-color: #ada6bf;
  --bs-secondary-bg: #292534;
  --bs-tertiary-bg: #211e2c;
  --bs-border-color: #373140;
  --bs-link-color: #b7a9ff;
  --bs-link-color-rgb: 183, 169, 255;
  --bs-link-hover-color: #d4cbff;
  --bs-link-hover-color-rgb: 212, 203, 255;
  --pg-surface: #1b1823;
  --pg-soft: #292534;
  --pg-shadow: 0 16px 48px rgb(0 0 0 / 25%);
  color-scheme: dark;
}
.btn-primary {
  --bs-btn-bg: var(--bs-primary);
  --bs-btn-border-color: var(--bs-primary);
  --bs-btn-color: var(--bs-body-bg);
  --bs-btn-hover-bg: var(--bs-link-hover-color);
  --bs-btn-hover-border-color: var(--bs-link-hover-color);
  --bs-btn-hover-color: var(--bs-body-bg);
  --bs-btn-active-bg: var(--bs-link-hover-color);
  --bs-btn-active-border-color: var(--bs-link-hover-color);
  --bs-btn-active-color: var(--bs-body-bg);
  --bs-btn-disabled-bg: var(--bs-primary);
  --bs-btn-disabled-border-color: var(--bs-primary);
  --bs-btn-disabled-color: var(--bs-body-bg);
  --bs-btn-focus-shadow-rgb: var(--bs-primary-rgb);
}
.navbar { --bs-navbar-active-color: var(--bs-primary); }
.form-check-input:checked { background-color: var(--bs-primary); border-color: var(--bs-primary); }
.dropdown-menu { --bs-dropdown-link-active-bg: var(--bs-primary); --bs-dropdown-link-active-color: var(--bs-body-bg); }
`;
