# ZH-L16C Analysis

Interactive web workbench for exploring the **Bühlmann ZH-L16C** decompression algorithm with **Gradient Factors (GF)**, examining how parameter choices shape no-decompression limits (NDL) and decompression schedules, generating custom dive tables, and comparing them against established dive tables.

**Live Site:** [https://matthewlai.github.io/ZHL16C_Analysis/](https://matthewlai.github.io/ZHL16C_Analysis/) *(currently hosting the initial placeholder page)*

---

## Project Goals

Modern dive computers almost universally run variants of Albert A. Bühlmann's 16-compartment Haldane model (**ZH-L16C**) paired with Erik Baker's linear **Gradient Factors (`GF Low` / `GF High`)**, yet divers often learn recreational diving on fixed tables (such as PADI RDP, NAUI, BSAC, or US Navy tables) without seeing how continuous compartment math relates to those schedules.

This project aims to make ZH-L16C tangible and visual in the browser:

1. **Gradient Factor & Dive Profile Explorer** — Adjust `GF Low`, `GF High`, depth, bottom time, ascent/descent rates, and gas mix (`Air` / `Nitrox` / `Trimix`) to see immediate effects on NDL, first stop depth, stop durations, and total time to surface (TTS).
2. **16-Compartment Tissue Loading & M-Value Plots** — Visualize inert gas tension across fast and slow compartments relative to ambient pressure and unscaled/GF-scaled M-value lines.
3. **Custom ZH-L16C Dive Table Generator** — Generate depth-by-time NDL and decompression tables for arbitrary gradient factor settings and breathing gases.
4. **Published Dive Table Comparison** — Compare ZH-L16C-generated tables side by side against classic reference dive tables (e.g., US Navy Rev 7, PADI RDP, classical Bühlmann ZH-L16B tables) to highlight where and why conservatism differs.

> **Disclaimer:** This software is strictly for **educational, analytical, and mathematical visualization purposes**. It has not been validated for life-support use. Never use schedules, NDLs, or tables produced by this tool to plan real-world dives.

---

## Tech Stack

- **Framework:** [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Build Tool:** [Vite](https://vite.dev/)
- **Styling:** Vanilla CSS custom properties (light & dark color schemes)
- **Linting:** [Oxlint](https://oxc.rs/docs/guide/usage/linter.html)
- **Hosting:** GitHub Pages via GitHub Actions (`.github/workflows/deploy.yml`)

---

## Local Development

### Prerequisites

- **Node.js** 22+ (Node 24 LTS recommended)
- **npm** 10+

### Commands

```bash
# Install dependencies
npm install

# Start local development server with HMR
npm run dev

# Run linter
npm run lint

# Type-check and build production static bundle into ./dist
npm run build

# Preview the production build locally
npm run preview
```

---

## Deployment

Pushes to `main` automatically trigger [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which runs `npm ci`, `npm run lint`, and `npm run build`, then publishes `./dist` to **GitHub Pages** using `actions/deploy-pages`.

---

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
