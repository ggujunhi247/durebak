import {Agent} from 'node:http';
import {createConnection,Socket} from 'node:net';
import {fail} from './domain.js';
interface Tuple {serverPort:number;clientPort:number}
interface Options {port:number;timeoutMs:number;verify:(tuple:Readonly<Tuple>)=>Promise<void>;assertLive:()=>void}
// A request-local Agent receives no socket until the same connected TCP stream
// passes the factory's kernel verifier. No keep-alive, fallback or POST retry.
export class OwnedPeerConnector {
 #closed=false;#agents=new Set<Agent>();#port:number;#timeout:number;#verify:Options['verify'];#assert:Options['assertLive'];
 constructor(options:Options){if(!Number.isInteger(options.port)||options.port<1||options.port>65535||!Number.isInteger(options.timeoutMs)||options.timeoutMs<10||options.timeoutMs>20000||typeof options.verify!=='function'||typeof options.assertLive!=='function')fail('native_peer_invalid');this.#port=options.port;this.#timeout=options.timeoutMs;this.#verify=options.verify;this.#assert=options.assertLive;}
 get port(){return this.#port;}
 createAgent(){if(this.#closed)fail('native_peer_closed');this.#assert();if(this.#agents.size>=16)fail('native_peer_pending_limit');const agent=new Agent({keepAlive:false}),destroy=agent.destroy.bind(agent);let cancel:()=>void=()=>{},started=false;this.#agents.add(agent);agent.destroy=()=>{cancel();destroy();this.#agents.delete(agent);};
  agent.createConnection=(options,callback)=>{if(!callback)fail('native_peer_invalid');if(started||this.#closed||options.host!=='127.0.0.1'||Number(options.port)!==this.#port){const socket=new Socket();socket.destroy();callback(new Error('native_peer_unverified'),socket);return undefined;}started=true;let settled=false,handed=false;const socket=createConnection({host:'127.0.0.1',port:this.#port});socket.pause();
   const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);socket.removeListener('readable',unexpected);if(error){socket.destroy();callback(new Error('native_peer_unverified'),socket);}else{handed=true;callback(null,socket);}};
   const unexpected=()=>finish(new Error('native_peer_unverified'));
   const timer=setTimeout(()=>finish(new Error('native_peer_timeout')),this.#timeout);cancel=()=>{if(!handed)finish(new Error('native_peer_closed'));socket.destroy();};socket.once('readable',unexpected);socket.on('error',()=>finish(new Error('native_peer_unverified')));socket.once('close',()=>{if(!handed)finish(new Error('native_peer_unverified'));});socket.once('connect',()=>{void(async()=>{try{if(this.#closed)throw new Error('closed');this.#assert();if(socket.localAddress!=='127.0.0.1'||socket.remoteAddress!=='127.0.0.1'||socket.remotePort!==this.#port||!socket.localPort)throw new Error('tuple');await this.#verify(Object.freeze({serverPort:this.#port,clientPort:socket.localPort}));this.#assert();if(this.#closed||socket.destroyed||socket.readableLength)throw new Error('closed');finish();}catch{finish(new Error('native_peer_unverified'));}})();});
   // Returning the connecting socket would let Agent flush queued credentials.
   return undefined;
  };return agent;
 }
 close(){if(this.#closed)return;this.#closed=true;for(const agent of [...this.#agents])agent.destroy();}
}
