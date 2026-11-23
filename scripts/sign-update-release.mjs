import {createHash,createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {lstatSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {inspectTarball} from './lib/package-check.mjs';
import {channelForVersion,compareVersions,releaseVersion} from '../dist/updates.js';
import {schemaVersion} from '../dist/migrations.js';
import {protocolVersion} from '../dist/version.js';
import {trustedUpdateKeys} from '../dist/update-trust.js';

const repository='https://github.com/ggujunhi247/durebak';
const lifetime=7*24*60*60*1000;
const maxArtifactBytes=64*1024*1024;

export function signUpdateRelease(bytes,{version,minUpdater,schema,protocol,issuedAt},privateKey) {
 if(privateKey.type!=='private'||privateKey.asymmetricKeyType!=='ed25519')throw new Error('invalid_update_signing_key');
 releaseVersion.parse(version);
 releaseVersion.parse(minUpdater);
 if(compareVersions(minUpdater,version)>=0||!Number.isSafeInteger(issuedAt+lifetime)||![issuedAt,schema,protocol].every(n=>Number.isSafeInteger(n)&&n>=0))throw new Error('invalid_update_release');
 if(bytes.length===0||bytes.length>maxArtifactBytes)throw new Error('invalid_update_artifact_size');
 const keyId=createHash('sha256').update(createPublicKey(privateKey).export({format:'der',type:'spki'})).digest('hex');
 const channel=channelForVersion(version);
 const artifact={url:`${repository}/releases/download/v${version}/durebak-${version}.tgz`,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
 const manifests={};
 for(const platform of ['darwin','linux']){
  for(const arch of ['x64','arm64']){
   const payload=Buffer.from(JSON.stringify({schema:1,package:'durebak',version,channel,platform,arch,min_updater:minUpdater,database_schema:schema,protocol,issued_at:issuedAt,expires_at:issuedAt+lifetime,artifact}));
   manifests[`${platform}-${arch}`]={key_id:keyId,payload:payload.toString('base64'),signature:sign(null,payload,privateKey).toString('base64')};
  }
 }
 return manifests;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {values}=parseArgs({options:{tarball:{type:'string'},output:{type:'string'},'min-updater':{type:'string'},'issued-at':{type:'string'}}});
 const secret=process.env.DUREBAK_UPDATE_SIGNING_KEY;
 if(!secret)throw new Error('update_signing_key_required');
 if(!values.tarball||!values.output||!values['min-updater']||!/^\d+$/.test(values['issued-at']??''))throw new Error('update_signing_arguments_required');
 const manifest=JSON.parse(readFileSync('package.json','utf8'));
 if(manifest.name!=='durebak'||manifest.repository?.url!==`${repository}.git`)throw new Error('unexpected_update_package');
 const artifact=lstatSync(values.tarball);
 if(!artifact.isFile()||artifact.size===0||artifact.size>maxArtifactBytes)throw new Error('invalid_update_artifact_size');
 inspectTarball(values.tarball,manifest);
 const key=createPrivateKey({key:Buffer.from(secret,'base64'),format:'der',type:'pkcs8'});
 const envelopes=signUpdateRelease(readFileSync(values.tarball),{version:manifest.version,minUpdater:values['min-updater'],schema:schemaVersion,protocol:protocolVersion,issuedAt:Number(values['issued-at'])},key);
 if(!Object.hasOwn(trustedUpdateKeys,envelopes['linux-x64'].key_id))throw new Error('untrusted_release_signing_key');
 for(const [target,envelope] of Object.entries(envelopes))writeFileSync(join(values.output,`update-${target}.json`),JSON.stringify(envelope)+'\n',{flag:'wx'});
}
