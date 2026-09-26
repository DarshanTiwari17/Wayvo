/**
 * Migration sanity checks.
 *
 * These catch the class of mistake that is invisible until someone runs the SQL
 * against a real database: a constraint, index or comment referencing a column
 * that the same file has not added yet. Postgres executes statements in order,
 * so that fails with `42703: column "x" does not exist` partway through the
 * script, leaving the migration half applied.
 *
 * This is not hypothetical — `0004_trip_hierarchy.sql` shipped with exactly that
 * bug: the `journey_segments_status_check` constraint was created in a DO block
 * above the statement that added the `status` column.
 */
import fs from 'node:fs'
import path from 'node:path'

const MIGRATIONS = path.resolve(process.cwd(), 'supabase/migrations')

const results: { n: string; p: boolean }[] = []
const check = (n: string, p: boolean, d = '') => {
  results.push({ n, p })
  console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  :: ' + d : ''}`)
}

/* -------------------------------------------------------------------------
 * What each table has, from the migration that creates it.
 * ---------------------------------------------------------------------- */
const BASE_COLUMNS: Record<string, Set<string>> = {
  profiles: new Set(['id', 'full_name', 'email', 'avatar_url', 'phone', 'created_at', 'updated_at']),
  trips: new Set([
    'id', 'profile_id', 'title', 'origin', 'destination', 'status', 'starts_on', 'ends_on',
    'created_at', 'updated_at',
  ]),
  disruptions: new Set([
    'id', 'profile_id', 'trip_id', 'kind', 'severity', 'headline', 'detail', 'reported_at', 'resolved_at',
  ]),
  recovery_plans: new Set([
    'id', 'profile_id', 'trip_id', 'disruption_id', 'title', 'summary', 'total_cost', 'currency',
    'status', 'created_at', 'updated_at',
  ]),
  journey_segments: new Set([
    'id', 'trip_id', 'seq', 'origin', 'destination', 'departure_at', 'arrival_at', 'transport_mode',
    'operator_name', 'service_number', 'booking_reference', 'pnr', 'seat', 'coach', 'terminal',
    'ticket_number', 'created_at', 'updated_at',
  ]),
  journey_documents: new Set([
    'id', 'profile_id', 'trip_id', 'storage_path', 'file_name', 'mime_type', 'byte_size', 'origin',
    'gmail_message_id', 'gmail_attachment_id', 'extraction_status', 'extracted', 'created_at',
  ]),
  gmail_connections: new Set([
    'profile_id', 'gmail_address', 'scopes', 'status', 'refresh_token', 'access_token',
    'token_expires_at', 'last_synced_at', 'created_at', 'updated_at',
  ]),
}

/** Words that appear in SQL but are not columns. */
const NOT_A_COLUMN = new Set([
  'and', 'or', 'not', 'null', 'is', 'in', 'between', 'case', 'when', 'then', 'else', 'end',
  'select', 'from', 'where', 'exists', 'coalesce', 'now', 'true', 'false', 'check', 'constraint',
  'alter', 'table', 'add', 'column', 'if', 'public', 'auth', 'storage', 'gen_random_uuid',
  'default', 'primary', 'key', 'references', 'on', 'delete', 'cascade', 'set', 'first', 'unique',
  'lower', 'upper', 'length', 'char_length', 'btrim', 'array', 'values', 'drop', 'begin', 'declare',
])

const files = fs
  .readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()

const known = new Map<string, Set<string>>()
for (const [table, columns] of Object.entries(BASE_COLUMNS)) known.set(table, new Set(columns))

check('migrations are present', files.length >= 4, `${files.length} files`)
check('the trip hierarchy migration exists', files.includes('0004_trip_hierarchy.sql'))

/* -------------------------------------------------------------------------
 * Split into statements without tearing DO blocks apart.
 *
 * A PL/pgSQL body is full of semicolons, so a naive split on ";" turns one
 * `add constraint ... check (...)` into fragments that no longer parse — and
 * the whole check then passes because it found nothing. Verified by injecting
 * the original bug and watching this fail.
 * ---------------------------------------------------------------------- */
function statements(code: string): { text: string; at: number }[] {
  // Replace semicolons inside `$$ ... $$` with a sentinel so the block stays whole.
  const masked = code.replace(/do \$\$[\s\S]*?\$\$;/gi, (block) => block.replace(/;/g, '\u0001'))
  const out: { text: string; at: number }[] = []
  let at = 0
  for (const part of masked.split(';')) {
    const text = part.replace(/\u0001/g, ';').trim()
    if (text) out.push({ text, at })
    at += part.length + 1
  }
  return out
}

for (const file of files) {
  const raw = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')
  // Strip line comments so commented-out examples are not parsed as real SQL.
  const code = raw.replace(/--[^\n]*/g, '')
  const stmts = statements(code)

  /* --- pass 1: what does this file declare, and where? ------------------ */
  const addedAt = new Map<string, number>() // "table.column" -> statement index
  const addedHere = new Set<string>()

  stmts.forEach((stmt, index) => {
    const createTable = stmt.text.match(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*)\)\s*$/i,
    )
    if (createTable) {
      const [, table, body] = createTable
      if (!known.has(table)) known.set(table, new Set())
      for (const part of body.split(',')) {
        const column = part.trim().match(/^(\w+)\s+(?:uuid|text|integer|boolean|numeric|char|timestamptz|date|jsonb|bigint)/i)
        if (column) {
          known.get(table)!.add(column[1])
          const key = `${table}.${column[1]}`
          addedAt.set(key, index)
          addedHere.add(key)
        }
      }
    }

    const addColumn = stmt.text.match(
      /alter\s+table\s+(?:public\.)?(\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/i,
    )
    if (addColumn) {
      const [, table, column] = addColumn
      if (!known.has(table)) known.set(table, new Set())
      known.get(table)!.add(column)
      const key = `${table}.${column}`
      addedAt.set(key, index)
      addedHere.add(key)
    }
  })

  /* --- pass 2: where is each column referenced? -------------------------- */
  type Reference = { table: string; column: string; kind: string; at: number }
  const references: Reference[] = []

  stmts.forEach((stmt, index) => {
    // add constraint <name> check ( ...cols... ), including inside a DO block.
    //
    // A single DO block can contain several constraints guarded by the same
    // `alter table`, so this cannot be one regex match: it would find only the
    // first. Each constraint is instead attributed to the nearest preceding
    // `alter table` in the same statement, and its body runs to the next `;`.
    const tablePositions = [...stmt.text.matchAll(/alter\s+table\s+(?:public\.)?(\w+)/gi)].map((m) => ({
      table: m[1],
      at: m.index ?? 0,
    }))

    for (const constraint of stmt.text.matchAll(/add\s+constraint\s+\w+\s+check\s*\(/gi)) {
      const start = (constraint.index ?? 0) + constraint[0].length
      const semi = stmt.text.indexOf(';', start)
      const body = stmt.text
        .slice(start, semi === -1 ? stmt.text.length : semi)
        .replace(/\)\s*$/, '')

      const table = [...tablePositions].reverse().find((t) => t.at <= (constraint.index ?? 0))?.table
      if (!table) continue // constraint with no table in this statement

      // Drop string literals: a check constraint lists its allowed values
      // ('manual', 'upload', 'gmail'), and those are not columns.
      const withoutLiterals = body.replace(/'[^']*'/g, ' ')
      for (const word of withoutLiterals.match(/[a-z_][a-z0-9_]*/gi) ?? []) {
        references.push({ table, column: word.toLowerCase(), kind: 'constraint', at: index })
      }
    }

    // create index ... on <table> ( <cols> )
    const createIndex = stmt.text.match(
      /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?\w+\s+on\s+(?:public\.)?(\w+)\s*\(([^)]*)\)/i,
    )
    if (createIndex) {
      for (const part of createIndex[2].split(',')) {
        const column = part.trim().match(/^(\w+)/)
        if (column) references.push({ table: createIndex[1], column: column[1].toLowerCase(), kind: 'index', at: index })
      }
    }
  })

  check(
    `${file}: schema declarations were found to check`,
    references.length > 0 || /add\s+column|create\s+table/i.test(code),
    `${references.length} constraint/index reference(s)`,
  )

  for (const reference of references) {
    if (NOT_A_COLUMN.has(reference.column)) continue

    const key = `${reference.table}.${reference.column}`
    if (!known.has(reference.table)) continue

    // A column from the creating migration, or one this file adds: both fine,
    // provided this file adds it BEFORE the reference.
    if (BASE_COLUMNS[reference.table]?.has(reference.column)) continue

    if (!addedHere.has(key)) {
      if (known.get(reference.table)?.has(reference.column)) {
        check(`${file}: ${key} used by ${reference.kind} exists from an earlier migration`, true)
        continue
      }
      check(
        `${file}: ${key} used by ${reference.kind} is a real column`,
        false,
        'never declared',
      )
      continue
    }

    const declaredAt = addedAt.get(key)!
    check(
      `${file}: ${key} is added before the ${reference.kind} uses it`,
      declaredAt < reference.at,
      declaredAt < reference.at ? '' : `declared at statement ${declaredAt}, used at ${reference.at}`,
    )
  }

  /* --- idempotency: safe to run twice ---------------------------------- *
   * Safe shapes:
   *   * `if not exists` / `if exists` / `drop` guards
   *   * `enable|force row level security` and `owner to` — no-ops when repeated
   *   * `add constraint` inside a DO block that checks pg_constraint first
   * ------------------------------------------------------------------- */
  const doBlocks = code.match(/do \$\$[\s\S]*?\$\$;/gi) ?? []
  const codeWithoutBlocks = doBlocks.reduce((acc, block) => acc.replace(block, ' '), code)
  const guardedConstraints = new Set(
    [
      ...[...code.matchAll(/conname\s*=\s*'(\w+)'/gi)].map((m) => m[1]),
      ...[...code.matchAll(/drop\s+constraint\s+if\s+exists\s+(\w+)/gi)].map((m) => m[1]),
    ],
  )

  const alters = codeWithoutBlocks.match(/alter table[^;]*/gi) ?? []
  const unguarded = alters.filter((a) => {
    if (/if not exists|if exists|drop/i.test(a)) return false
    if (/enable row level security|force row level security|owner to/i.test(a)) return false
    const added = a.match(/add constraint (\w+)/i)
    return !(added && guardedConstraints.has(added[1]))
  })

  check(
    `${file}: every alter is idempotent`,
    unguarded.length === 0,
    unguarded.length
      ? `${unguarded.length} unguarded: ${unguarded[0].replace(/\s+/g, ' ').trim().slice(0, 60)}`
      : '',
  )
}

const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.log('\nFAILURES:')
  failed.forEach((f) => console.log(' - ' + f.n))
}
process.exit(failed.length ? 1 : 0)
