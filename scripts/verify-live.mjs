import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { backendConfig, readOnlyJson, requestEvidence } from './backend-config.mjs';
import { inspectBackend } from './inspect-backend.mjs';

const check = (id, status, scope, detail, evidence) => ({ id, status, scope, detail, ...(evidence ? { evidence } : {}) });
const denied = result => !result.ok && [401, 403].includes(result.status);

/** Read-only is the default even when an administrator token is present. */
export async function verifyLive(config = backendConfig(), options = {}) {
  const { url, key } = config;
  const env = options.env ?? process.env;
  const read = path => readOnlyJson(`${url}${path}`, { apikey: key }, options);
  const [inspection, authSettingsRead, missingSessionRead, adminRead, ledgerRead, bucketRead] = await Promise.all([
    inspectBackend(config, options),
    read('/auth/v1/settings'),
    read('/auth/v1/user'),
    read('/rest/v1/catalog_admins?select=user_id&limit=1'),
    read('/rest/v1/catalog_imports?select=source_key,product_id&limit=0'),
    read('/storage/v1/bucket/product-images'),
  ]);
  const settings = authSettingsRead.data;
  const authSettings = {
    ...requestEvidence(authSettingsRead),
    emailEnabled: typeof settings?.external?.email === 'boolean' ? settings.external.email : null,
    disableSignup: typeof settings?.disable_signup === 'boolean' ? settings.disable_signup : null,
    emailAutoconfirm: typeof settings?.mailer_autoconfirm === 'boolean' ? settings.mailer_autoconfirm : null,
  };
  const checks = [
    check('public-catalog-reads', inspection.requiredReadsPassed ? 'passed' : 'failed', 'read-only',
      'Anonymous category/product reads and required field selections against the existing project.', {
        categories: inspection.categoryReads, products: inspection.productReads, columns: inspection.schema.requiredColumns,
      }),
    check('missing-session-denied', denied(missingSessionRead) ? 'passed' : 'failed', 'read-only',
      'The Auth user endpoint rejects a request without a user session.', requestEvidence(missingSessionRead)),
    check('anonymous-admin-table-denied', denied(adminRead) ? 'passed' : 'failed', 'read-only',
      'Public credentials cannot read catalog administrator membership. This does not inspect membership totals or authenticated privileges.', requestEvidence(adminRead)),
    check('auth-settings-readable', authSettingsRead.ok ? 'passed' : 'failed', 'read-only',
      'Public Auth settings can be read; this does not exercise email delivery or sign-in.', requestEvidence(authSettingsRead)),
    check('anonymous-unpublished-isolation', inspection.unpublishedVisible ? 'failed' : 'blocked', 'live-RLS',
      inspection.unpublishedVisible
        ? 'A non-published row was visible to the anonymous caller.'
        : 'No controlled Draft/Archived fixture was tested. Empty or published-only public responses cannot establish full isolation.'),
    check('owner-schema-inspection', 'blocked', 'privileged-read',
      'Owner SQL inspection of actual constraints, grants and RLS policies requires authorized privileged access.'),
    check('authenticated-crud', 'blocked', 'live-integration',
      'An approved administrator session and an explicit isolated write run are required to verify persistence, update, publication, archive, deletion and cleanup.'),
    check('authenticated-non-admin-rls', 'blocked', 'live-RLS',
      'No verified non-admin user session is available to test read isolation, write denial or self-grant denial.'),
    check('auth-email-flows', 'blocked', 'live-integration',
      'Approved staff and non-admin accounts, actual invite/recovery email delivery and allowed redirects must be verified separately.'),
    check('storage-integration', 'blocked', 'live-integration',
      'Anonymous bucket metadata cannot prove bucket existence or upload/download/deletion policy behavior. An authenticated isolated object test is required.', requestEvidence(bucketRead)),
    check('real-catalogue-acceptance', 'blocked', 'source-acceptance',
      'The actual approved PDF products and photographs must be checked after review/import; temporary integration fixtures cannot establish source accuracy.'),
  ];
  const readOnlyChecksPassed = checks.filter(item => item.scope === 'read-only').every(item => item.status === 'passed');
  const report = {
    verifiedAt: new Date().toISOString(), project: url,
    mode: options.writeTest ? 'read-only-with-explicit-write-test' : 'read-only',
    readOnlyChecksPassed, fullAcceptanceComplete: false,
    checks, inspection, authSettings,
    importLedger: { ...requestEvidence(ledgerRead), availability: ledgerRead.ok ? 'available' : ledgerRead.errorCode === 'PGRST205' ? 'missing-in-api-schema' : 'unverified' },
    storageMetadata: {
      ...requestEvidence(bucketRead), bucketExistence: bucketRead.ok ? 'confirmed' : 'unverified',
      note: 'NoSuchBucket with public credentials can result from metadata access restrictions; it does not establish that the bucket is missing.',
    },
    limitations: [
      'Only anonymous-visible rows were read; no database-wide product or administrator totals were measured.',
      'Default verification performs GET requests only. No sign-up, sign-in, email, database write or storage upload occurs.',
      'Public reads and metadata cannot prove full RLS, authenticated CRUD, email flows, storage integration or real catalogue accuracy.',
    ],
  };
  if (options.writeTest) {
    if (!env.CATALOG_ADMIN_ACCESS_TOKEN) {
      report.writeVerification = { status: 'blocked', reason: 'Set CATALOG_ADMIN_ACCESS_TOKEN securely for an approved authenticated catalog administrator before an explicit --write-test run.' };
    } else if (!readOnlyChecksPassed) {
      report.writeVerification = { status: 'blocked', reason: 'Required read-only preflight failed; no isolated writes were attempted.' };
    } else {
      const writeRunner = options.writeRunner ?? (await import('./live-write-verification.mjs')).runWriteVerification;
      try {
        report.writeVerification = await writeRunner({ url, key, token: env.CATALOG_ADMIN_ACCESS_TOKEN });
      } catch {
        report.writeVerification = {
          status: 'failed', cleanupStatus: 'unverified',
          reason: 'The isolated write runner did not return a completion report. Error bodies were redacted; verify cleanup of this run before retrying.',
        };
      }
    }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    let output;
    let writeTest = false;
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--write-test') writeTest = true;
      else if (args[index] === '--output' && args[index + 1]) output = args[++index];
      else throw new Error('Usage: node scripts/verify-live.mjs [--output docs/live-verification.json.local] [--write-test]');
    }
    if (output && !output.endsWith('.local')) throw new Error('Save live verification output only to an ignored *.local file.');
    const report = await verifyLive(backendConfig(), { writeTest });
    const json = JSON.stringify(report, null, 2) + '\n';
    if (output) await writeFile(output, json, { mode: 0o600 });
    console.log(json);
    if (!report.readOnlyChecksPassed || (writeTest && report.writeVerification?.status !== 'passed')) process.exitCode = 1;
  } catch (error) {
    // Preserve operator-facing validation messages, never unknown backend errors.
    const safeMessage = typeof error?.message === 'string' && /^(Usage:|Save live verification output|Use the existing Brutti project|Set the public publishable\/anon key|Private Supabase keys|A valid public Supabase|Only the public anon key|The public anon key)/.test(error.message);
    console.error(safeMessage ? error.message : 'Live verification did not complete; unexpected error details were redacted.');
    process.exitCode = 1;
  }
}
