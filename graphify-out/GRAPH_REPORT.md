# Graph Report - CRM COMGRAF  (2026-11-18)

## Corpus Check
- 181 files · ~97,548 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 20 file(s) not represented in the graph (top: .css 9, (none) 7, .example 1)

## Summary
- 1289 nodes · 4125 edges · 98 communities (61 shown, 37 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 255 edges (avg confidence: 0.93)
- Token cost: unreported (the subagent executor did not expose token usage)

## Community Hubs (Navigation)
- CAI and Production Services
- Workflow Regression Tests
- Models and Deletion
- Alembic Migrations
- Frontend Domain Catalog
- Client and Case UI
- Application Navigation
- Backend API Services
- Dates and Activity UI
- Case API Endpoints
- Case Operations UI
- FastAPI Runtime
- Load Benchmark
- Schemas and Validation
- Low Resource Settings
- Authentication and Roles
- Workflow UI Components
- Order Printing
- Backup and Setup Scripts
- API Contract and Dates
- Scanner and Decision APIs
- Low Resource Networking
- Scan Migration Utilities
- Frontend Lint Dependencies
- Production Conversion Validation
- Resource Limits
- Retired Messaging Tests
- Compose Base Network
- Reverse Proxy Configuration
- Frontend Tooling Versions
- Runtime Logging
- Database Container
- Low Resource Network
- Frontend Fonts and Styles
- Production E2E Flows
- Frontend Runtime Packages
- Application Container Compose
- Image Build Metadata
- MySQL Resource Limits
- CAI Branding E2E
- Frontend Command Scripts
- Service Health Checks
- Container Log Rotation
- Production Workflow Docs
- Approved Design Print Tests
- Print Layout Tests
- Print Preview Tests
- Scanner API
- Quotes and Cancellation Validation
- Database Environment
- Database Health Checks
- Workflow E2E Tests
- Container Build Args
- Maintenance Docs
- Financial Workflow Docs
- Agenda Order E2E
- Client Delete Smoke
- Permission Navigation Tests
- UI Smoke Tests
- Vite Build Tooling
- Formatting Settings
- Retired Channel Docs
- Low Resource Operations Docs
- Manual Completion Tests
- Mixed Order PDF Samples
- LAN Diagnosis Script
- App Database Config
- Deletion Unit Tests
- Local Linux Launcher
- Task Scheduling Endpoint
- MySQL Entry Point
- Multi Product Preview
- Order Continuation Print
- Printed Client Name
- Client Name Preview
- Historical Order Print
- Compact Print Template
- Print Preview Controls
- Multi OP Selector
- Print Format Selector
- Historical Identity Snapshot
- Deployment Diagnosis
- Compose Wrapper
- Camera HTTPS Setup
- HTTPS Setup
- Backup Operations
- Frappe Pattern References
- COMGRAF Brand Asset
- Browser Favicon
- CAI Customer Print Sample
- Recovered CAI Print Sample
- Mixed OP Print Preview
- Multi OP Case Screen
- Printed CAI Form
- Optional Client Print
- Letter Format Print Layout

## God Nodes (most connected - your core abstractions)
1. `must()` - 86 edges
2. `create()` - 75 edges
3. `mutate()` - 72 edges
4. `conversion()` - 72 edges
5. `api()` - 70 edges
6. `Case` - 53 edges
7. `Production` - 48 edges
8. `key()` - 44 edges
9. `ErrorBox()` - 41 edges
10. `CasePage()` - 40 edges

## Surprising Connections (you probably didn't know these)
- `Product version distinct from HTTP contract version` --conceptually_related_to--> `React FastAPI SQLAlchemy and MySQL stack`  [INFERRED]
  docs/ACTUALIZACION_1_5.md → README.md
- `accounts()` --uses--> `Base`  [INFERRED]
  backend/tests/conftest.py → backend/app/db.py
- `preview_client()` --uses--> `Case`  [INFERRED]
  backend/app/deletion.py → backend/app/models.py
- `_delete_cases()` --uses--> `Case`  [INFERRED]
  backend/app/deletion.py → backend/app/models.py
- `_delete_cases()` --uses--> `Ledger`  [INFERRED]
  backend/app/deletion.py → backend/app/models.py

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Production order print samples** — output_pdf_nombre_cliente_capturado_cai_order_with_captured_client_identity_and_overflowed_observation_page, output_pdf_op_cai_diseno_recuperado_recovered_cai_order_design_print_sample, output_pdf_op_mixta_carta_diseno_recuperado_recovered_letter_size_mixed_order_pagination_stress_sample, output_pdf_op_mixta_carta_letter_size_mixed_order_pagination_stress_sample, output_pdf_op_mixta_media_carta_diseno_recuperado_recovered_half_letter_mixed_order_pagination_stress_sample, output_pdf_op_mixta_media_carta_half_letter_mixed_order_pagination_stress_sample [INFERRED 0.85]

## Communities (98 total, 37 thin omitted)

### Community 0 - "CAI and Production Services"
Cohesion: 0.07
Nodes (114): cai_summary(), is_cai_product(), new_order_product(), uses_print_form(), main(), Case, Delivery, Event (+106 more)

### Community 1 - "Workflow Regression Tests"
Cohesion: 0.08
Nodes (104): Quote, today(), ItemInput, completions(), test_all_cancelled_stays_active_and_completed_case_requires_reactivation_for_correction(), test_manual_work_and_pending_quote_block_automatic_completion(), test_multiple_orders_and_cross_balances_never_complete_early(), test_prepaid_order_waits_for_delivery_and_last_payment_completes() (+96 more)

### Community 2 - "Models and Deletion"
Cohesion: 0.06
Nodes (61): Base, _case_scope(), delete_case(), _delete_cases(), delete_client(), preview_cases(), preview_client(), require_admin() (+53 more)

### Community 3 - "Alembic Migrations"
Cohesion: 0.06
Nodes (19): upgrade(), upgrade(), upgrade(), upgrade(), upgrade(), upgrade(), downgrade(), upgrade() (+11 more)

### Community 4 - "Frontend Domain Catalog"
Cohesion: 0.09
Nodes (39): RadioGroup(), CAI_PRODUCTS, CASE_PRIORITIES, CASE_STATUSES, DEFAULT_DELIVERY_METHOD, DELIVERY_METHOD_OPTIONS, FISCAL_DOCUMENT_TYPES, LEGACY_CAI_PRODUCT (+31 more)

### Community 5 - "Client and Case UI"
Cohesion: 0.13
Nodes (30): ClientIdentityFields(), ClientActionsMenu(), ClientDialog(), Clients(), Field(), FormDialog(), Modal(), Operation() (+22 more)

### Community 6 - "Application Navigation"
Cohesion: 0.10
Nodes (32): can(), PRODUCT_VERSION, setTimezone(), App(), logout(), BindingScanner, breadcrumbs(), CasePage (+24 more)

### Community 7 - "Backend API Services"
Cohesion: 0.12
Nodes (9): get_db(), User, retired_communication(), download(), current_user(), accounts(), clients(), migrate() (+1 more)

### Community 8 - "Dates and Activity UI"
Cohesion: 0.21
Nodes (22): date, dateHonduras, dayKey(), formatDateTime(), localDate(), CaseActivity(), CaseAttention(), EditableTitle() (+14 more)

### Community 9 - "Case API Endpoints"
Cohesion: 0.12
Nodes (27): assign(), attention(), complete(), complete_case(), decision(), details(), events(), reactivate_case() (+19 more)

### Community 10 - "Case Operations UI"
Cohesion: 0.13
Nodes (21): localInput(), money(), quantity(), toUTC(), CASE_COUNTS, CASE_READ_MODELS, invalidateCaseViews(), CancellationPreview() (+13 more)

### Community 11 - "FastAPI Runtime"
Cohesion: 0.10
Nodes (11): attention_recovery_loop(), error_code(), guard(), health(), http_error(), integrity(), lifespan(), spa() (+3 more)

### Community 12 - "Load Benchmark"
Cohesion: 0.15
Nodes (14): bytes_value(), Client, collect_container_stats(), disk_counters(), docker_project_containers(), functional_smoke(), host_metrics(), load_test() (+6 more)

### Community 13 - "Schemas and Validation"
Cohesion: 0.14
Nodes (22): AdjustmentInput, AdminStageInput, Assignment, CaseDetailsInput, CaseUpdate, ClientInput, ClientUpdate, CompleteDeliveryInput (+14 more)

### Community 14 - "Low Resource Settings"
Cohesion: 0.08
Nodes (26): environment, environment, ACCESS_LOG, APP_HOST, APP_LOG_DIR, APP_PORT, APP_TIMEZONE, APP_WORKERS (+18 more)

### Community 15 - "Authentication and Roles"
Cohesion: 0.17
Nodes (18): Role, Session, add_user(), change_password(), login(), logout(), me(), RoleInput (+10 more)

### Community 16 - "Workflow UI Components"
Cohesion: 0.16
Nodes (23): api(), uid(), BindingScanner(), requestException(), saveScannedTitle(), changeLifecycle(), toggleAttention(), TakeCaseButton() (+15 more)

### Community 17 - "Order Printing"
Cohesion: 0.17
Nodes (18): caiDimensions, CasePrintSheet(), field(), genericFields, identityFor(), itemFields(), SheetHeader(), sheetRows() (+10 more)

### Community 18 - "Backup and Setup Scripts"
Cohesion: 0.18
Nodes (7): docker(), filesystem(), main(), require_local(), main(), mount_for(), read_env()

### Community 19 - "API Contract and Dates"
Cohesion: 0.16
Nodes (12): API_CONTRACT_VERSION, assertContract(), dateParts(), FIELD_NAMES, formatDate(), makeError(), responseData(), responseError() (+4 more)

### Community 20 - "Scanner and Decision APIs"
Cohesion: 0.14
Nodes (15): confirm_finished(), decide_exception(), request_exception(), scan(), BindingScanInput, ContactInput, Input, LoginInput (+7 more)

### Community 21 - "Low Resource Networking"
Cohesion: 0.12
Nodes (16): condition, app, HTTPS_HOST, HTTPS_PORT, cpus, depends_on, environment, image (+8 more)

### Community 22 - "Scan Migration Utilities"
Cohesion: 0.21
Nodes (4): downgrade(), upgrade(), snapshot(), start_http()

### Community 23 - "Frontend Lint Dependencies"
Cohesion: 0.19
Nodes (12): devDependencies, eslint@9.39.5, @eslint/js@9.39.5, eslint-plugin-react@7.37.5, eslint-plugin-react-hooks@7.1.1, globals@17.13.0, @playwright/test@1.58.2, eslint (+4 more)

### Community 24 - "Production Conversion Validation"
Cohesion: 0.21
Nodes (4): convert(), Conversion, ProductionRequestInput, Specs

### Community 25 - "Resource Limits"
Cohesion: 0.17
Nodes (12): cpus, depends_on, image, mem_limit, networks, pids_limit, restart, user (+4 more)

### Community 26 - "Retired Messaging Tests"
Cohesion: 0.25
Nodes (4): CaseInput, test_new_case_input_needs_no_origin_or_relation(), test_old_mutation_urls_are_gone(), test_old_or_placeholder_case_types_are_not_new_case_inputs()

### Community 27 - "Compose Base Network"
Cohesion: 0.18
Nodes (10): internal, name, networks, internal, web, services, volumes, mail_secrets (+2 more)

### Community 28 - "Reverse Proxy Configuration"
Cohesion: 0.18
Nodes (11): condition, app, HTTPS_HOST, depends_on, environment, image, networks, ports (+3 more)

### Community 29 - "Frontend Tooling Versions"
Cohesion: 0.18
Nodes (10): prettier@3.9.10, engines, node, name, overrides, esbuild, private, type (+2 more)

### Community 30 - "Runtime Logging"
Cohesion: 0.31
Nodes (3): configure_file_logging(), main(), test_start_only_runs_migrations_and_web()

### Community 31 - "Database Container"
Cohesion: 0.20
Nodes (10): environment, image, networks, restart, volumes, MYSQL_DATABASE, MYSQL_PASSWORD, MYSQL_ROOT_PASSWORD (+2 more)

### Community 32 - "Low Resource Network"
Cohesion: 0.20
Nodes (9): internal, name, networks, internal, web, services, volumes, caddy_config (+1 more)

### Community 33 - "Frontend Fonts and Styles"
Cohesion: 0.20
Nodes (7): @fontsource/inter@^5.3.0, @fontsource/jetbrains-mono@^5.3.0, react-dom@19.2.4, client, @fontsource/inter, @fontsource/jetbrains-mono, react-dom

### Community 34 - "Production E2E Flows"
Cohesion: 0.28
Nodes (4): credentials, headers, credentials, @playwright/test

### Community 35 - "Frontend Runtime Packages"
Cohesion: 0.22
Nodes (9): dependencies, lucide-react@0.577.0, qrcode@1.5.4, react@19.2.4, react-router-dom@7.18.4, @tanstack/react-query@5.90.21, @zxing/browser@0.2.1, qrcode (+1 more)

### Community 36 - "Application Container Compose"
Cohesion: 0.25
Nodes (8): depends_on, env_file, networks, restart, volumes, condition, db, app

### Community 37 - "Image Build Metadata"
Cohesion: 0.29
Nodes (8): build, BUILD_COMMIT, BUILD_DATE, MYSQL_SERVER_VERSION, args, context, dockerfile, build

### Community 38 - "MySQL Resource Limits"
Cohesion: 0.25
Nodes (8): cpus, image, mem_limit, networks, pids_limit, restart, volumes, db

### Community 39 - "CAI Branding E2E"
Cohesion: 0.25
Nodes (4): credentials, headers, credentials, headers

### Community 40 - "Frontend Command Scripts"
Cohesion: 0.25
Nodes (8): scripts, build, dev, format, format:check, lint, test:e2e, test:unit

### Community 41 - "Service Health Checks"
Cohesion: 0.48
Nodes (7): healthcheck, healthcheck, interval, retries, start_period, test, timeout

### Community 42 - "Container Log Rotation"
Cohesion: 0.38
Nodes (7): logging, logging, logging, driver, options, max-file, max-size

### Community 43 - "Production Workflow Docs"
Cohesion: 0.29
Nodes (6): One product per production order, Periodic overdue follow-up recovery, Production order print snapshots, Local Comgraf logo and favicon assets, CAI catalog validation and error response repair, Printable half-letter production order

### Community 45 - "Print Layout Tests"
Cohesion: 0.29
Nodes (3): credentials, headers, record

### Community 47 - "Scanner API"
Cohesion: 0.47
Nodes (3): exception_result(), exceptions(), lookup()

### Community 49 - "Database Environment"
Cohesion: 0.33
Nodes (6): environment, DB_HOST, DB_PORT, PRODUCT_VERSION, STATIC_DIR, UPLOAD_DIR

### Community 50 - "Database Health Checks"
Cohesion: 0.53
Nodes (6): healthcheck, healthcheck, interval, retries, test, timeout

### Community 51 - "Workflow E2E Tests"
Cohesion: 0.33
Nodes (3): credentials, errors, headers

### Community 52 - "Container Build Args"
Cohesion: 0.40
Nodes (5): build, BUILD_COMMIT, BUILD_DATE, args, context

### Community 53 - "Maintenance Docs"
Cohesion: 0.40
Nodes (3): Product version distinct from HTTP contract version, Frontend and backend responsibility map, React FastAPI SQLAlchemy and MySQL stack

### Community 54 - "Financial Workflow Docs"
Cohesion: 0.40
Nodes (4): Idempotent concurrent mutations, Signed financial ledger, Transactional activity history, Note activity query cache key mismatch

### Community 55 - "Agenda Order E2E"
Cohesion: 0.50
Nodes (4): createOrder(), credentials, headers, post()

### Community 56 - "Client Delete Smoke"
Cohesion: 0.40
Nodes (4): casePreview, caseRow, preview, profile

### Community 57 - "Permission Navigation Tests"
Cohesion: 0.50
Nodes (3): credentials, headers, PERMISSION_CATALOG

### Community 59 - "Vite Build Tooling"
Cohesion: 0.40
Nodes (4): vite@7.3.7, @vitejs/plugin-react@5.1.4, vite, @vitejs/plugin-react

### Community 60 - "Formatting Settings"
Cohesion: 0.40
Nodes (4): printWidth, semi, singleQuote, trailingComma

### Community 61 - "Retired Channel Docs"
Cohesion: 0.50
Nodes (3): Historical channel pause procedure, Version 1.5 implementation verification, Historical integration and browser verification

### Community 62 - "Low Resource Operations Docs"
Cohesion: 0.50
Nodes (3): Low resource Docker LAN profile, Target hardware benchmark remains pending, Measured query count and frontend bundle changes

### Community 64 - "Mixed Order PDF Samples"
Cohesion: 0.67
Nodes (4): Recovered letter-size mixed order pagination stress sample, Letter-size mixed order pagination stress sample, Recovered half-letter mixed order pagination stress sample, Half-letter mixed order pagination stress sample

### Community 65 - "LAN Diagnosis Script"
Cohesion: 0.83
Nodes (3): have(), section(), diagnose-lan-host.sh script

## Knowledge Gaps
- **40 isolated node(s):** `Idempotent concurrent mutations`, `Periodic overdue follow-up recovery`, `Separate database and attachment backups`, `Measured query count and frontend bundle changes`, `Frappe CRM patterns adapted without copied code` (+35 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 357 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **37 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@playwright/test` connect `Production E2E Flows` to `CAI Branding E2E`, `Approved Design Print Tests`, `Print Layout Tests`, `Print Preview Tests`, `Workflow E2E Tests`, `Frontend Lint Dependencies`, `Agenda Order E2E`, `Client Delete Smoke`, `Permission Navigation Tests`, `UI Smoke Tests`, `Frontend Tooling Versions`, `Manual Completion Tests`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **What connects `Idempotent concurrent mutations`, `Periodic overdue follow-up recovery`, `Separate database and attachment backups` to the rest of the system?**
  _40 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `CAI and Production Services` be split into smaller, more focused modules?**
  _Cohesion score 0.06697061803444782 - nodes in this community are weakly interconnected._
- **Why does `Case` connect `CAI and Production Services` to `Workflow Regression Tests`, `Models and Deletion`, `Backend API Services`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Should `Workflow Regression Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.07871148459383753 - nodes in this community are weakly interconnected._
- **Why does `api()` connect `Workflow UI Components` to `Frontend Domain Catalog`, `Client and Case UI`, `Application Navigation`, `Dates and Activity UI`, `Case Operations UI`, `Order Printing`, `API Contract and Dates`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Should `Models and Deletion` be split into smaller, more focused modules?**
  _Cohesion score 0.06429548563611491 - nodes in this community are weakly interconnected._