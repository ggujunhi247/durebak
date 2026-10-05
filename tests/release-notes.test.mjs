import test from 'node:test';
import assert from 'node:assert/strict';
import {extractReleaseNotes} from '../scripts/release-notes.mjs';

const changelog='# Changelog\n\n## 0.1.0-alpha.19 — 2026-10-05\n\n- Observer fix.\n\n### Limits\n\nNative execution remains unverified.\n\n## 0.1.0-alpha.18 — 2026-10-05\n\n- Previous fix.\n';
test('release notes include only the exact tagged version and its subheadings',()=>{
 assert.equal(extractReleaseNotes(changelog,'v0.1.0-alpha.19'),'## 0.1.0-alpha.19 — 2026-10-05\n\n- Observer fix.\n\n### Limits\n\nNative execution remains unverified.\n');
 assert.equal(extractReleaseNotes(changelog,'v0.1.0-alpha.18'),'## 0.1.0-alpha.18 — 2026-10-05\n\n- Previous fix.\n');
});
test('missing, empty, duplicate or invalid version notes stop release generation',()=>{
 assert.throws(()=>extractReleaseNotes(changelog,'v0.1.0-alpha.1'),/missing/);
 assert.throws(()=>extractReleaseNotes('## 1.2.3\n\n','v1.2.3'),/empty/);
 assert.throws(()=>extractReleaseNotes('## 1.2.3\n- One\n## 1.2.3\n- Two\n','v1.2.3'),/duplicate/);
 for(const tag of ['1.2.3','v1.2.3;exit','v1.2.3-alpha.1x'])assert.throws(()=>extractReleaseNotes(changelog,tag),/invalid/);
});
