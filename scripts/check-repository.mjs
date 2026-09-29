import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
const files = execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{encoding:'utf8'}).split('\0').filter(Boolean);
const forbidden = /(^|\/)(node_modules|dist|coverage|\.superpowers|\.worktrees|\.durebak)(\/|$)|(^|\/)(admin|credentials|connection)\.json$|(^|\/)runtime\.lock$|\.(sqlite(?:-.+)?|db(?:-.+)?|tgz|pem|key)$|(^|\/)\.env(?:\..+)?$/;
const secrets = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{30,}/, /\bxox[baprs]-[A-Za-z0-9-]{20,}/, /["']token["']\s*:\s*["'][a-f0-9]{64}["']/];
const failures = [];
for (const file of files) {
  if (forbidden.test(file) && !file.endsWith('.env.example')) { failures.push(`${file}: runtime/credential/generated file`); continue; }
  if (!lstatSync(file).isFile()) { failures.push(`${file}: non-regular tracked entry`); continue; }
  const text=readFileSync(file,'utf8');
  if (secrets.some(pattern=>pattern.test(text))) failures.push(`${file}: possible credential (value redacted)`);
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode=1; }
else console.log(`Repository hygiene checked: ${files.length} files. Pattern scanning supplements human review; it is not a proof of absence.`);
