/**
 * Parses every Edge Function to catch syntax and import errors without needing
 * Deno installed. The functions are not executed: they need the Deno runtime
 * and real Google credentials to mean anything.
 */
import fs from 'node:fs'
import path from 'node:path'
import { transform } from 'esbuild'

const root = 'C:/Users/Lenovo/Desktop/HackCelestial/supabase/functions'
const results = []
const check = (n, p, d = '') => {
  results.push({ n, p })
  console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  :: ' + d : ''}`)
}

const files = []
for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
  if (dir.isDirectory()) {
    const index = path.join(root, dir.name, 'index.ts')
    if (fs.existsSync(index)) files.push(index)
  }
}
const shared = path.join(root, '_shared')
if (fs.existsSync(shared)) {
  for (const name of fs.readdirSync(shared)) {
    if (name.endsWith('.ts')) files.push(path.join(shared, name))
  }
}

check('edge functions are present', files.length >= 5, `${files.length} files`)

for (const file of files) {
  const relative = path.relative(root, file).replace(/\\/g, '/')
  try {
    await transform(fs.readFileSync(file, 'utf8'), {
      loader: 'ts',
      format: 'esm',
      target: 'es2022',
    })
    check(`${relative} parses`, true)
  } catch (error) {
    check(`${relative} parses`, false, error.message.split('\n')[0])
  }
}

/* --- each function must handle the real failure modes ------------------- */
const expectations = [
  ['gmail-connect', ['not_configured', 'GMAIL_SCOPES', 'state', 'signState', 'unauthorised', 'access_type: \'offline\'']],
  ['gmail-callback', ['denied', 'verifyState', 'refresh_token', 'exchangeCodeForTokens', 'safeReturnTo']],
  ['gmail-search', ['not_connected', 'reauth_required', 'refreshAccessToken', 'TRAVEL_QUERY', 'last_synced_at']],
  ['gmail-extract', ['not_connected', 'refreshAccessToken', 'findTravelAttachments', 'extractPlainText']],
]

for (const [name, needles] of expectations) {
  const source = fs.readFileSync(path.join(root, name, 'index.ts'), 'utf8')
  for (const needle of needles) {
    check(`${name} handles ${needle}`, source.includes(needle))
  }
}

/* --- the shared module must carry the minimum scope --------------------- */
{
  const gmail = fs.readFileSync(path.join(shared, 'gmail.ts'), 'utf8')
  check('requests gmail.readonly', gmail.includes('auth/gmail.readonly'))
  check('requests userinfo.email (to display the address)', gmail.includes('auth/userinfo.email'))
  for (const scope of ['auth/send', 'auth/modify', 'auth/gmail.compose', 'auth/drive', 'auth/calendar', 'auth/contacts']) {
    check(`does NOT request ${scope}`, !gmail.includes(scope))
  }
  const search = fs.readFileSync(path.join(root, 'gmail-search', 'index.ts'), 'utf8')
  check('the query is time-bounded and subject/sender scoped', /newer_than:\d+d/.test(gmail) && gmail.includes('subject:'))
  check('the query is sent to Gmail (q= on the messages endpoint)', /q: TRAVEL_QUERY/.test(search) && search.includes('/messages?'))
  check('only metadata is fetched for the list', search.includes('format=metadata'))
  check('the full message is fetched only in gmail-extract', !search.includes('format=full'))
}

/* --- no secret or token may reach a browser bundle ---------------------- */
{
  const client = fs.readFileSync('C:/Users/Lenovo/Desktop/HackCelestial/src/services/gmailService.ts', 'utf8')
  check('client never references the Google client secret', !client.includes('GOOGLE_CLIENT_SECRET'))
  check('client never references the service role key', !client.includes('SERVICE_ROLE'))
  check('client never puts a JWT in a URL', !/searchParams\.set\(\s*['"]session/.test(client))
  check('client never stores a refresh token', !/localStorage.*refresh/i.test(client))
  check('client selects only the safe columns', client.includes('profile_id, gmail_address, scopes, status, last_synced_at'))
  check('client does not select token columns', !/select\([^)]*refresh_token/.test(client))
}

const failed = results.filter((r) => !r.p)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  console.log('\nFAILURES:')
  failed.forEach((f) => console.log(' - ' + f.n))
}
process.exit(failed.length ? 1 : 0)
