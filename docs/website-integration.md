# Existing website integration — review artifact, no deployment

Read-only GitHub Pages API inspection confirms `benua-brutti-website` owns **https://brutti.my/** (custom domain, workflow publishing, HTTPS enforced). The catalog has separate Pages URL **https://brutti-team.github.io/brutti-catalog/** without a custom domain. No website source, workflow, DNS or deployed artifact was changed.

GitHub Pages cannot reverse-proxy two applications into one domain. The catalog supports a reviewed **combined static artifact** while preserving the website root and pages:

```sh
# From brutti-catalog with approved PUBLIC build configuration:
npm run build:site
node scripts/assemble-site.mjs --website /path/to/reviewed-website-build --catalog dist-site --out integration-review.local
```

The site build emits /admin/index.html, /catalog/index.html and /catalog-assets/. It emits no replacement root index or 404. Assembly reads the supplied website artifact only, copies its bytes unchanged into a new ignored *.local output, adds catalog entries/assets and records source hashes/inventories. It refuses existing output, collisions, overlapping paths, symlinks, hidden credential files and private credential bytes. It does not rebuild/edit the website or deploy anything. Review assembly-report.json; it explicitly does not establish source build freshness.

Actual assembly against the existing local website dist succeeded. Website root SHA-256 before/after was `4bed5ae17a52ed2d6ca9f8d62fa3130458f817424596b1abe7428b83b0cd18c8`. That artifact was not independently checked against the live website; obtain a fresh approved website build before final integration.

Static-server browser tests with no SPA fallback verify direct /admin/ and /catalog/, refresh, existing #/product/<id> and #/catalog/product/<id> links, preserved Auth fragments/query strings, root preservation and real 404 behavior. These tests intercept backend fixtures; actual invitations and live hosted routes still need acceptance. Do not publish test artifacts or test credentials.

For separate catalog Pages, use `npm run build:pages` (base /brutti-catalog/). `npm run build:configured` first checks real public settings/reads, then prepares Pages without deployment. Source-only builds are compilation evidence only. VITE_BASE_PATH can explicitly set a reviewed absolute base; malformed bases are rejected.

Auth must use the actual approved catalog entry. Future combined hosting should invite to `https://brutti.my/admin/?auth=invite` and allow `https://brutti.my/admin/?auth=recovery`; the website root does not host catalog Auth. Separate Pages equivalents include /brutti-catalog/admin/. Only allow destinations after the appropriate host/build is approved and available. Preserve SDK token fragments and keep private server keys outside the browser.

Before launch, verify real admin/email/Storage/RLS behavior, approved source imports and public publication, prepare a fresh combined artifact and obtain explicit website-change, merge and deployment approvals. Current workflows validate only.
