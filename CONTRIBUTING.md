# 🤝 Contributing to Hardware Point POS

Thank you for your interest in contributing to **Hardware Point POS**! We are committed to maintaining enterprise-level software engineering standards, clean architecture layering, and rigorous type/lint safety.

> [!IMPORTANT]
> **License & Permission Notice**:
> This repository is governed by the **Hardware Point POS Permission-Based Non-Commercial License**. Before making contributions, running deployments, or distributing derivative works, ensure you have obtained permission from the project author [Haider Ali](https://github.com/Haiderali445).

---

## 📋 Table of Contents
1. [Code of Conduct](#-code-of-conduct)
2. [Architectural Principles & Layering Rules](#-architectural-principles--layering-rules)
3. [Development Workflow](#-development-workflow)
4. [Branching & Commit Guidelines](#-branching--commit-guidelines)
5. [Pull Request Checklist](#-pull-request-checklist)
6. [Testing & Verification Requirements](#-testing--verification-requirements)
7. [Reporting Bugs & Requesting Features](#-reporting-bugs--requesting-features)

---

## 📜 Code of Conduct
We expect all participants to maintain an open, welcoming, diverse, inclusive, and professional environment. Respect constructive feedback, prioritize collective code quality, and maintain clear technical communication.

---

## 🏛️ Architectural Principles & Layering Rules

Every contribution **must** adhere strictly to our decoupled multi-tier architectural standards:

### 1. Frontend Rules (`client/`)
- **Zero Raw API Calls in Components**: Never use raw `fetch()` or direct `apiClient` / `axios` within React component files or hooks. All remote endpoints must be defined in `src/services/` and consumed via React Query hooks in `src/hooks/usePosQueries.js`.
- **Decoupled Business Calculations**: All financial formulas, pricing calculations, item status badges, line totals, and data filters must reside as pure functions within `src/calculaters/`. Components should only call these imported pure functions.
- **Action & Event Handlers**: Form submissions, modal orchestration, and entity CRUD operations must be delegated to action handlers in `src/handlers/`.
- **Centralized Error Interception**: Never write inline try-catch blocks with raw `console.log` or manual error string parsing in UI components. Use `notifyError()` and `notifySuccess()` from `src/utils/errorHandler.js`.
- **Presentation Layer Purity**: React components in `src/pages/` and `src/components/` must be pure presentation wrappers focused exclusively on Ant Design UI rendering, layout markup, and local state (e.g., active modal toggles, search inputs).

### 2. Backend Rules (`server/`)
- **Domain-Driven Layering**:
  - `src/presentation/`: Express routers, controllers, and authentication middlewares.
  - `src/application/`: Application services (`AuthService.js`) orchestrating business use cases.
  - `src/domain/`: Repository contracts and abstract interfaces (`RepositoryContracts.js`).
  - `src/infrastructure/`: Concrete Mongoose implementations (`MongooseUserRepository.js`), token signers (`JoseTokenSigner.js`), and database configuration.
- **Dependency Inversion**: High-level application services must depend on domain abstractions (interfaces/contracts), never directly on low-level Mongoose query instances.
- **Zero In-Memory Route Staling**: When adding new controllers or routes, verify that all routers are properly registered in `server.js` and express route tables are updated.

---

## 💻 Development Workflow

### 1. Fork & Clone
```bash
git clone https://github.com/Haiderali445/mern-pos.git
cd mern-pos
```

### 2. Environment Configuration
Copy `.env.example` templates to both server and client:
```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

### 3. Install Dependencies
```bash
# Monorepo root dependencies
npm install

# Server dependencies
cd server && npm install && cd ..

# Client dependencies
cd client && npm install && cd ..
```

### 4. Seed Database & Run
```bash
# Seed initial admin and cashier accounts
cd server && npm run seed && cd ..

# Run concurrent full-stack development environment
npm run dev
```

---

## 🌿 Branching & Commit Guidelines

### Branch Naming Conventions
Use descriptive branch names prefixed with the change type:
- `feature/pos-split-payment`
- `fix/thermal-receipt-overflow`
- `refactor/dealer-service-decoupling`
- `docs/api-spec-enhancement`
- `perf/query-cache-stale-tuning`

### Commit Message Standards (Conventional Commits)
All commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

#### Types:
- `feat`: A new user-facing feature or capability.
- `fix`: A bug fix or error correction.
- `refactor`: Code changes that neither fix a bug nor add a feature (e.g. Clean Architecture decoupling).
- `perf`: Performance optimizations (e.g. query caching, memoization).
- `docs`: Documentation updates only.
- `style`: Formatting, missing semicolons, CSS tweaks without logic changes.
- `test`: Adding or correcting tests.
- `chore`: Build scripts, package updates, or configuration changes.

#### Examples:
```bash
git commit -m "feat(billing): implement partial payment ledger and credit tracking"
git commit -m "fix(client): resolve ResizeObserver loop notifications in Stockpage"
git commit -m "refactor(services): isolate product queries into dedicated productService"
```

---

## ✅ Pull Request Checklist

Before submitting your pull request, ensure all items below are verified:

- [ ] Code compiles with **zero warnings and zero errors** (`npm --prefix client run build` exits with code 0).
- [ ] No raw axios or direct fetch calls inside components or hooks.
- [ ] Business logic, formulas, and data mappings are extracted to `src/calculaters/`.
- [ ] CRUD operations use `src/handlers/` and centralized error notification via `errorHandler.js`.
- [ ] All new backend routes are covered with role authorization where appropriate (`verifyToken`, `requireRole(["admin"])`).
- [ ] Responsive design verified across desktop (1440px), tablet (768px), and mobile (375px) viewports.
- [ ] Thermal receipt print styles (80mm) function correctly in Chrome print preview.
- [ ] No secrets, database passwords, or private JWT tokens committed to git history.

---

## 🧪 Testing & Verification Requirements

When submitting a PR, provide reproducible verification steps in your PR description:
1. **Frontend Verification**:
   - Verify that `npm run build` runs cleanly.
   - Test POS keyboard hotkeys (`F2`, `F4`, `Ctrl+K`, `Esc`).
   - Confirm barcode scanner inputs populate the cart correctly.
2. **Backend Verification**:
   - Verify HTTP status codes (`200 OK`, `201 Created`, `400 Bad Request`, `401 Unauthorized`, `404 Not Found`).
   - Validate that stock decreases by the exact cart quantity upon bill creation.

---

## 🐛 Reporting Bugs & Requesting Features

- **Bug Reports**: Open an issue describing the expected vs. actual behavior, browser/OS versions, terminal error stack traces, and reproduction steps.
- **Feature Requests**: Open an issue detailing the use case, affected business domain, proposed UI mockups, and architectural impact.

Thank you for helping make **Hardware Point POS** an enterprise-grade standard!
