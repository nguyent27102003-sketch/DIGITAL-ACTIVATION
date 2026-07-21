import db from './src/db/index.js';
import path from 'path';

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('\n=== ACTUAL TABLES IN data/fbeval.db ===');
tables.forEach(t => console.log(' -', t.name));

console.log('\n=== COLUMN DETAILS ===');
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
  console.log(`\n[${t.name}]`);
  cols.forEach(c => console.log(`  ${c.name} ${c.type}${c.notnull ? ' NOT NULL' : ''}${c.dflt_value !== null ? ' DEFAULT ' + c.dflt_value : ''}`));
}
