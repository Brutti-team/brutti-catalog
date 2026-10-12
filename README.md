# Brutti Catalog

Digital Furniture Catalog Management System for **Benua Brutti Sdn. Bhd.**

> **Project status:** Initial setup. The application has not been built yet.

## Overview

Brutti Catalog will let the Brutti team add and manage furniture products through an admin dashboard, then display published products on a customer-facing catalog. Staff should not need to edit code whenever a product changes.

This is a **separate project** designed for future integration with the existing Brutti website at [brutti.my](https://brutti.my).

## Planned Features

### Admin Dashboard
- Secure admin login and appropriate role-based permissions
- Add, edit, duplicate, archive and delete products
- Product name, description, category, materials, dimensions, SKU and optional price
- Upload, preview, optimize and reorder multiple product images (WebP)
- Search, sort, filter and manage product categories
- Separate publishing status: **Draft / Published / Archived**
- Product availability: **Available / Made to Order / Unavailable**
- Preview before publishing

### Public Catalog
- Mobile-friendly furniture product gallery and product detail pages
- Search, categories, filters and featured products
- Enquiry option without checkout
- Only published products appear publicly
- Helpful loading, empty and error states

## Proposed Tech Stack

- **Frontend:** React, Vite, TypeScript
- **Database and backend:** Supabase (to be configured)
- **Authentication:** Supabase Auth (to be configured)
- **Image storage:** Supabase Storage (to be configured)
- **Version control:** GitHub
- **AI coding agent:** OpenAI Codex

## Website Integration

The existing website repository is [Brutti-team/benua-brutti-website](https://github.com/Brutti-team/benua-brutti-website).

Planned target paths:
- `brutti.my/admin` — catalog administration (authorized staff only)
- `brutti.my/catalog` — public catalog

These URLs are **planned**, not live. Validate hosting, routing and deployment configuration before integration.

## Development Roadmap

1. Scaffold the standalone React + Vite + TypeScript project.
2. Build the responsive catalog UI and admin dashboard using safe demo data.
3. Set up the Supabase schema, authentication, Row Level Security and image storage.
4. Implement product publishing, images, categories, status and search.
5. Test permissions, functionality and responsive design.
6. Prepare and review integration with the existing website.
7. Deploy only after approval.

## Development Guidelines

- Follow Brutti branding and use a clean, premium, accessible design.
- Keep catalog data in the database, not hardcoded product arrays.
- Never commit secrets or Supabase service-role keys; use environment variables.
- Use the public client key only with carefully verified access policies.
- Do not connect to or alter production data during development.
- Do not modify or deploy the existing Brutti website without approval.
- Use feature branches and pull requests for review before merging changes.

---

© Benua Brutti Sdn. Bhd.
