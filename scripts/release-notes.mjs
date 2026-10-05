import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function extractReleaseNotes(changelog, tag) {
 if(!/^v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(tag))throw new Error('invalid_release_tag');
 const lines=changelog.replace(/\r\n/g,'\n').split('\n');
 const headings=[];
 for(let i=0;i<lines.length;i++)if(/^## /.test(lines[i]))headings.push(i);
 const matches=headings.filter(i=>lines[i].slice(3).split(/\s/)[0]===tag.slice(1));
 if(matches.length===0)throw new Error('missing_release_notes');
 if(matches.length!==1)throw new Error('duplicate_release_notes');
 const start=matches[0];
 const end=headings.find(i=>i>start)??lines.length;
 if(!lines.slice(start+1,end).join('\n').trim())throw new Error('empty_release_notes');
 return lines.slice(start,end).join('\n').trimEnd()+'\n';
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 if(process.argv.length!==3)throw new Error('usage: node scripts/release-notes.mjs vVERSION');
 process.stdout.write(extractReleaseNotes(readFileSync('CHANGELOG.md','utf8'),process.argv[2]));
}
