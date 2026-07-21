/**
 * Test Runner V2.1 — FBEval Universal Campaign Evaluator
 * 
 * IMPORTANT: This runner explicitly documents which tests use mock/test data
 * and which tests require real runtime environments.
 * Per spec §17: test reports must declare mock vs real, AI call status, and DB status.
 */
import { performance } from 'perf_hooks';

const TEST_SUITES = [
  // ── UNIT TESTS (No network, no AI, no real DB writes) ──────────────────
  {
    name: 'Unit: Gemini JSON Sanitization & Parsing',
    file: './unit_analyzer.test.js',
    type: 'UNIT',
    usesMock: false,
    usesAI: false,
    usesDB: false,
    usesNetwork: false,
    usesRealExcel: false
  },
  {
    name: 'Unit: Metric Parser (0/null/K/Tr/N/Duration)',
    file: './unit_metric_parser.test.js',
    type: 'UNIT',
    usesMock: false,
    usesAI: false,
    usesDB: false,
    usesNetwork: false,
    usesRealExcel: false
  },
  {
    name: 'Unit: URL Normalizer (Facebook/TikTok)',
    file: './unit_url_normalizer.test.js',
    type: 'UNIT',
    usesMock: false,
    usesAI: false,
    usesDB: false,
    usesNetwork: false,
    usesRealExcel: false
  },
  {
    name: 'Unit: Access State Detector',
    file: './unit_access_state.test.js',
    type: 'UNIT',
    usesMock: false,
    usesAI: false,
    usesDB: false,
    usesNetwork: false,
    usesRealExcel: false
  },
  {
    name: 'Unit: Decision Engine (ĐK1/ĐK2 Boundary Values)',
    file: './unit_decision_engine.test.js',
    type: 'UNIT',
    usesMock: false,
    usesAI: false,
    usesDB: false,
    usesNetwork: false,
    usesRealExcel: false
  },
  {
    name: 'Unit: Excel Extraction & Exporting',
    file: './unit_excel.test.js',
    type: 'UNIT',
    usesMock: false,
    usesAI: false,
    usesDB: false,
    usesNetwork: false,
    usesRealExcel: false,
    note: 'Creates and uses synthetic Excel file'
  },
  {
    name: 'Unit: Database Migration & Schema',
    file: './unit_db_migration.test.js',
    type: 'UNIT',
    usesMock: false,
    usesAI: false,
    usesDB: true,
    usesNetwork: false,
    usesRealExcel: false
  },
  {
    name: 'Unit: User Auth & Admin Approval Matrix',
    file: './unit_user_auth_matrix.test.js',
    type: 'UNIT',
    usesMock: false,
    usesAI: false,
    usesDB: true,
    usesNetwork: false,
    usesRealExcel: false
  },
  {
    name: 'Integration & Security: Google OAuth & RBAC Flow',
    file: './integration_google_auth.test.js',
    type: 'INTEGRATION',
    usesMock: true,
    usesAI: false,
    usesDB: true,
    usesNetwork: false,
    usesRealExcel: false
  },
  {
    name: 'Unit: AI Request Logging & Hashes',
    file: './unit_ai_request_logging.test.js',
    type: 'UNIT',
    usesMock: false,
    usesAI: false,
    usesDB: true,
    usesNetwork: false,
    usesRealExcel: false
  },
  {
    name: 'Unit: Evidence SHA-256 Hash',
    file: './unit_evidence_hash.test.js',
    type: 'UNIT',
    usesMock: false,
    usesAI: false,
    usesDB: false,
    usesNetwork: false,
    usesRealExcel: false
  },
  {
    name: 'Unit: Retry Policy & Exponential Backoff',
    file: './unit_retry_policy.test.js',
    type: 'UNIT',
    usesMock: false,
    usesAI: false,
    usesDB: false,
    usesNetwork: false,
    usesRealExcel: false
  },
  {
    name: 'Unit: Job Recovery Idempotency',
    file: './unit_recovery_idempotency.test.js',
    type: 'UNIT',
    usesMock: false,
    usesAI: false,
    usesDB: true,
    usesNetwork: false,
    usesRealExcel: false
  },

  // ── INTEGRATION & SECURITY TESTS ─────────────────────────────────────
  {
    name: 'Integration: Manual Review Transaction',
    file: './integration_manual_review_transaction.test.js',
    type: 'INTEGRATION',
    usesMock: false,
    usesAI: false,
    usesDB: true,
    usesNetwork: false,
    usesRealExcel: false
  },
  {
    name: 'Integration: Playwright Scraper Engine',
    file: './integration_scraper.test.js',
    type: 'INTEGRATION',
    usesMock: true,
    usesAI: false,
    usesDB: false,
    usesNetwork: true,
    usesRealExcel: false,
    note: 'Uses local mock HTTP server. Playwright runs against localhost:5055.'
  },
  {
    name: 'Integration: Job Orchestrator (100 Links Queue)',
    file: './orchestration_100_links.test.js',
    type: 'INTEGRATION',
    usesMock: true,
    usesAI: false,
    usesDB: true,
    usesNetwork: false,
    usesRealExcel: false,
    note: 'TEST_MODE=true uses mock scrape results. SQLite queue storage is real.'
  },
  {
    name: 'Security: Redaction, Traversal & ZIP Slip',
    file: './security_tests.test.js',
    type: 'SECURITY',
    usesMock: false,
    usesAI: false,
    usesDB: false,
    usesNetwork: false,
    usesRealExcel: false
  }
];

async function runAll() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   FBEVAL BOT V2.1 — COMPREHENSIVE TEST SUITE RUNNER');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('System Status:');
  console.log('  IMPLEMENTATION STATUS : CORE CODE IMPLEMENTATION REPORTED COMPLETE');
  console.log('  ACCEPTANCE STATUS     : PENDING 6-GATE RUNTIME VERIFICATION');
  console.log('  GATE STATUS           : READY FOR GATE 1');
  console.log('');

  const results = [];
  const startTotal = performance.now();

  for (const suite of TEST_SUITES) {
    const start = performance.now();
    let status = 'PASSED';
    let errorMsg = '';

    try {
      const mod = await import(suite.file);
      await mod.run();
    } catch (err) {
      status = 'FAILED';
      errorMsg = err.message || String(err);
    }

    const duration = ((performance.now() - start) / 1000).toFixed(2) + 's';
    results.push({ ...suite, status, duration, error: errorMsg });
    
    if (status === 'FAILED' && suite.type === 'UNIT') {
      console.error(`\n[FATAL] Unit test failed — stopping runner: ${suite.name}`);
      console.error(errorMsg);
      break;
    }
  }

  const totalDuration = ((performance.now() - startTotal) / 1000).toFixed(2) + 's';
  const passed = results.filter(r => r.status === 'PASSED').length;
  const failed = results.filter(r => r.status === 'FAILED').length;

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                     TEST RUNNER SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Total Duration : ${totalDuration}`);
  console.log(`Suites Run     : ${results.length}`);
  console.log(`Passed         : ${passed}`);
  console.log(`Failed         : ${failed}`);
  console.log('');
  console.table(results.map(r => ({
    type: `[${r.type}]`,
    name: r.name,
    status: r.status,
    mock: r.usesMock ? 'MOCK' : 'REAL',
    ai: r.usesAI ? 'YES' : 'NO',
    db: r.usesDB ? 'YES' : 'NO',
    duration: r.duration,
    note: r.note || '',
    error: r.error ? r.error.substring(0, 100) : ''
  })));

  console.log('');
  if (failed === 0) {
    console.log('✅ All test suites completed successfully!');
  } else {
    console.log('❌ Test run failed. Review error logs above.');
    process.exit(1);
  }
}

runAll().catch(err => {
  console.error('\nFATAL runner error:', err);
  process.exit(1);
});
