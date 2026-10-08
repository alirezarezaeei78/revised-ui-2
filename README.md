# HamyarDoorbin

A Persian CCTV planning platform bringing engineering calculators, interactive visualization, and product information into one web application.

This repository contains the newer HamyarDoorbin codebase, built with **Next.js 16, React 19, TypeScript, Three.js, and PostgreSQL**, with a Capacitor Android shell. Explore the product at [hamyardoorbin.ir](https://hamyardoorbin.ir).

## Capabilities

- **CCTV calculations:** recording capacity, DORI, lens and field of view, RAID, and IP addressing.
- **Interactive planning:** 3D field-of-view visualization and camera planning interfaces.
- **Wireless tools:** Fresnel zones, sensitivity, and power conversion.
- **Application services:** registration, login, OTP integration, saved data, and administration routes.
- **Product discovery:** a searchable catalog with optional WooCommerce integration.
- **Assistant experiments:** optional local language-model integration through Ollama.
- **Android delivery:** a Capacitor WebView shell backed by the hosted Next.js application.

Features involving external services require their own configuration. This is a development codebase; validate calculations, integrations, and deployment settings for your intended use.

## Local setup

Use **Node.js 22 or newer**, npm, and PostgreSQL. Next.js requires Node.js 20.9 or newer; the test command also uses Node's TypeScript stripping support.

```sh
git clone https://github.com/alirezarezaeei78/revised-ui-2.git
cd revised-ui-2
npm ci
```

Copy `.env.example` to `.env.local`. Configure `DATABASE_URL`, `AUTH_SECRET`, and `PASSWORD_SECRET` with local values. Add SMS, WooCommerce, Ollama, or Capacitor settings only for integrations you intend to use. Keep `.env.local` out of version control.

```sh
npm run dev
```

Open [localhost:3000](http://localhost:3000). Database-backed routes require a reachable PostgreSQL database. To populate the sample catalog after configuring the database:

```sh
npm run seed:catalog
```

## Development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Check TypeScript types |
| `npm test` | Run the repository's Node test suite |
| `npm run build` | Create a production build |
| `npm start` | Serve a production build |
| `npm run llm:check` | Check the configured local model service |
| `npm run cap:sync:hosted` | Sync the hosted Android shell |
| `npm run cap:open` | Open the Android project |

## Repository map

| Path | Contents |
| --- | --- |
| `src/app/` | Application pages and API routes |
| `src/lib/` | Shared calculations, database access, and services |
| `tests/` | Automated tests and the test alias loader |
| `scripts/` | Catalog imports, seeding, and integration utilities |
| `public/` | Static assets |
| `android/` | Capacitor Android project |

## Technical documentation

- [Android / Capacitor setup](ANDROID_CAPACITOR.md)
- [WooCommerce integration](WOOCOMMERCE_SETUP.md)
- [Smart catalog architecture](SMART_CATALOG_ARCHITECTURE.md)
- [Assistant architecture](ASSISTANT_ARCHITECTURE.md)
- [Local language-model setup](LOCAL_LLM_SETUP.md)
- [Migration plan](MIGRATION_PLAN.md)

## Maintainer

[Alireza Rezaei](https://www.linkedin.com/in/alireza-rezaei-24963a210/) — technical leadership, web development, and applied machine learning.
