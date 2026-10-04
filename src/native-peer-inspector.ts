import {OwnedNativeCommand} from './owned-native-command.js';
import {mkdtempSync,realpathSync,writeFileSync,readFileSync,lstatSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {z} from 'zod';
import {fail} from './domain.js';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
const binaryHash=(file:string)=>createHash('sha256').update(readFileSync(file)).digest('hex');
const pidSchema=z.number().int().min(1).max(2147483647);
const birthSchema=z.object({pid:pidSchema,startSeconds:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),startMicros:z.number().int().min(0).max(999999)}).strict();
export type NativeBirth=z.infer<typeof birthSchema>;
const peerSchema=z.object({birth:birthSchema,serverPort:z.number().int().min(1).max(65535),clientPort:z.number().int().min(1).max(65535)}).strict();
// Parent-only owned-PID metadata. No process environments, paths or credentials
// are read. Snapshotting accepted FD possession does not exclude FD sharing.
const source=String.raw`
#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
static uint64_t number(const char *s,uint64_t min,uint64_t max){if(!s||!*s||strlen(s)>20)exit(2);for(const char *p=s;*p;p++)if(*p<'0'||*p>'9')exit(2);errno=0;char *end;unsigned long long n=strtoull(s,&end,10);if(errno||*end||n<min||n>max)exit(2);return n;}
static struct proc_bsdinfo identity(int pid,int parent){struct proc_bsdinfo b;memset(&b,0,sizeof(b));if(parent!=getppid()||proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&b,sizeof(b))!=sizeof(b)||b.pbi_pid!=(uint32_t)pid||b.pbi_ppid!=(uint32_t)parent||b.pbi_uid!=getuid()||!b.pbi_start_tvsec||b.pbi_start_tvusec>999999)exit(3);return b;}
int main(int argc,char **argv){if(argc!=4&&argc!=8)return 2;int pid=(int)number(argv[2],1,2147483647),parent=(int)number(argv[argc-1],1,2147483647);struct proc_bsdinfo before=identity(pid,parent);
 if(argc==4&&strcmp(argv[1],"birth")==0){printf("{\"pid\":%d,\"startSeconds\":%llu,\"startMicros\":%llu}\n",pid,(unsigned long long)before.pbi_start_tvsec,(unsigned long long)before.pbi_start_tvusec);return 0;}
 if(argc!=8||strcmp(argv[1],"peer")!=0)return 2;uint64_t sec=number(argv[3],1,9007199254740991ULL),usec=number(argv[4],0,999999);int server=(int)number(argv[5],1,65535),client=(int)number(argv[6],1,65535);if(before.pbi_start_tvsec!=sec||before.pbi_start_tvusec!=usec)return 3;
 struct proc_fdinfo fds[4097],afterfds[4097];int size=proc_pidinfo(pid,PROC_PIDLISTFDS,0,fds,sizeof(fds));if(size<=0||size%(int)sizeof(fds[0])||size>(int)(4096*sizeof(fds[0])))return 4;int count=size/(int)sizeof(fds[0]),matches=0;
 for(int i=0;i<count;i++){if(fds[i].proc_fd<0)return 4;if(fds[i].proc_fdtype!=PROX_FDTYPE_SOCKET)continue;struct socket_fdinfo fd;memset(&fd,0,sizeof(fd));if(proc_pidfdinfo(pid,fds[i].proc_fd,PROC_PIDFDSOCKETINFO,&fd,sizeof(fd))!=sizeof(fd))return 4;
  if(fd.psi.soi_kind!=SOCKINFO_TCP||fd.psi.soi_family!=AF_INET||fd.psi.soi_type!=SOCK_STREAM||fd.psi.soi_protocol!=IPPROTO_TCP)continue;const struct tcp_sockinfo *tcp=&fd.psi.soi_proto.pri_tcp;const struct in_sockinfo *in=&tcp->tcpsi_ini;
  if(tcp->tcpsi_state==TSI_S_ESTABLISHED&&in->insi_vflag==INI_IPV4&&in->insi_laddr.ina_46.i46a_addr4.s_addr==htonl(INADDR_LOOPBACK)&&in->insi_faddr.ina_46.i46a_addr4.s_addr==htonl(INADDR_LOOPBACK)&&ntohs((uint16_t)in->insi_lport)==server&&ntohs((uint16_t)in->insi_fport)==client)matches++;
 }
 struct proc_bsdinfo after=identity(pid,parent);if(after.pbi_start_tvsec!=sec||after.pbi_start_tvusec!=usec)return 3;int finalsize=proc_pidinfo(pid,PROC_PIDLISTFDS,0,afterfds,sizeof(afterfds));if(finalsize!=size||memcmp(fds,afterfds,(size_t)size)!=0)return 4;if(matches!=1)return 5;puts("{\"verified\":true}");return 0;}
`;
export class NativePeerInspector {
 #closed=false;#closing:Promise<void>|undefined;#pending=new Set<OwnedNativeCommand>();#digest:string|undefined;
 private constructor(private directory:string,private binary:string){}
 get root(){return this.directory;}
 static async build(){if(process.platform!=='darwin')fail('native_peer_unsupported');const directory=realpathSync.native(mkdtempSync(join(tmpdir(),'durebak-peer-'))),file=join(directory,'inspect.c'),binary=join(directory,'inspect');writeFileSync(file,source,{mode:0o600,flag:'wx'});const inspector=new NativePeerInspector(directory,binary);let compiler:OwnedNativeCommand|undefined;try{compiler=new OwnedNativeCommand('/usr/bin/clang',['-std=c11','-O2','-Wall','-Wextra','-Werror',file,'-o',binary,'-lproc'],{cwd:directory,env:{PATH:'/usr/bin:/bin',HOME:directory},timeoutMs:10000,maxBytes:8192});inspector.#pending.add(compiler);await compiler.result;chmodSync(binary,0o700);inspector.#digest=binaryHash(binary);return inspector;}catch{if(compiler&&!compiler.retired)throw new NativePeerBuildError(inspector);rmSync(directory,{recursive:true,force:true});fail('native_peer_build_failed');}finally{if(compiler?.retired)inspector.#pending.delete(compiler);}}
 private async run(args:string[]){if(this.#closed)fail('native_peer_closed');try{const dir=lstatSync(this.directory),file=lstatSync(this.binary);if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o077)||dir.uid!==process.getuid?.()||realpathSync.native(this.directory)!==this.directory||!file.isFile()||file.isSymbolicLink()||file.nlink!==1||file.size>1048576||(file.mode&0o077)||file.uid!==process.getuid?.()||binaryHash(this.binary)!==this.#digest)fail('native_peer_unverified');}catch{fail('native_peer_unverified');}if(this.#pending.size>=8)fail('native_peer_busy');const command=new OwnedNativeCommand(this.binary,args,{cwd:this.directory,env:{PATH:'/usr/bin:/bin'},timeoutMs:2000,maxBytes:4096});this.#pending.add(command);try{const result=await command.result;if(this.#closed)fail('native_peer_closed');if(result.stderr)fail('native_peer_unverified');return JSON.parse(result.stdout);}catch{if(this.#closed)fail('native_peer_closed');fail('native_peer_unverified');}finally{if(command.retired)this.#pending.delete(command);}}
 async observeOwnedBirth(raw:unknown):Promise<NativeBirth>{const parsed=pidSchema.safeParse(raw);if(!parsed.success)fail('native_peer_invalid');const result=birthSchema.safeParse(await this.run(['birth',String(parsed.data),String(process.pid)]));if(!result.success||result.data.pid!==parsed.data)fail('native_peer_unverified');return Object.freeze(result.data);}
 async inspectOwnedPeer(raw:unknown):Promise<{verified:true}>{const parsed=peerSchema.safeParse(raw);if(!parsed.success)fail('native_peer_invalid');const p=parsed.data;const result=z.object({verified:z.literal(true)}).strict().safeParse(await this.run(['peer',String(p.birth.pid),String(p.birth.startSeconds),String(p.birth.startMicros),String(p.serverPort),String(p.clientPort),String(process.pid)]));if(!result.success)fail('native_peer_unverified');return Object.freeze(result.data);}
 async waitOwnedPeer(raw:unknown,assertLive:()=>void,timeoutMs:number){if(!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>2000)fail('native_peer_invalid');const deadline=Date.now()+timeoutMs;while(true){assertLive();if(this.#closed)fail('native_peer_closed');try{const result=await this.inspectOwnedPeer(raw);assertLive();if(Date.now()>=deadline)fail('native_peer_unverified');return result;}catch(error){assertLive();if(this.#closed)fail('native_peer_closed');if(!(error instanceof Error)||error.message!=='native_peer_unverified'||Date.now()>=deadline)throw error;}await delay(Math.min(10,Math.max(1,deadline-Date.now())));}}
 close(){if(this.#closing)return this.#closing;this.#closed=true;this.#closing=(async()=>{await Promise.all([...this.#pending].map(command=>command.close()));this.#pending.clear();rmSync(this.directory,{recursive:true,force:true});})().catch(error=>{this.#closing=undefined;throw error;});return this.#closing;}
}

export class NativePeerBuildError extends Error {constructor(readonly inspector:NativePeerInspector){super('native_command_cleanup_unknown');}}
