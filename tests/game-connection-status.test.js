'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const createStatus=require('../src/ui/game-connection-status');
const {buildSource}=require('../scripts/build');
class Socket {
 static OPEN=1;
 constructor(url){this.url=url;this.readyState=0;this.listeners={};this.sent=[];}
 addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
 fire(type){this.readyState=type==='open'?1:3;for(const fn of this.listeners[type]??[])fn();}
 send(data){this.sent.push(data);}
}
test('only open game sockets count, not lobby lists or unrelated sockets',()=>{
 const seen=[],status=createStatus({baseUrl:'https://openfront.io/',onChange:value=>seen.push(value)});
 const game=new Socket('wss://falk2-b.openfront.io/w12');
 for(const url of ['wss://openfront.io/w0/lobbies','wss://example.com/w0','wss://openfront.io/other']){
  const socket=new Socket(url);status.track(socket,url);socket.fire('open');assert.equal(status.connected(),false);
 }
 status.track(game,game.url);assert.equal(status.connected(),false);
 game.fire('open');assert.equal(status.connected(),true);
 game.fire('close');assert.equal(status.connected(),false);
 assert.deepEqual(seen,[true,false]);
});
test('closing an old socket does not clear a replacement connection',()=>{
 const status=createStatus({baseUrl:'https://openfront.io/'}),a=new Socket('/w1'),b=new Socket('/w2');
 status.track(a,a.url);a.fire('open');status.track(b,b.url);b.fire('open');
 a.fire('close');assert.equal(status.connected(),true);
 b.fire('close');assert.equal(status.connected(),false);
});
test('shipped hook observes binary game sockets without changing packets or legacy command routing',()=>{
 const source=buildSource().source,dot={dataset:{}},window={WebSocket:Socket,location:{href:'https://openfront.io/'}};
 window.top=window;
 const context=vm.createContext({window,URL,document:{getElementById:()=>dot}});
 const a=source.indexOf('const _NativeWS=window.WebSocket;'),b=source.indexOf('function _setLastKnownTile(',a);
 vm.runInContext(source.slice(a,b),context);
 const socket=new window.WebSocket('wss://openfront.io/w3');socket.fire('open');
 assert.equal(dot.dataset.status,'connected');
 const binary=new Uint8Array([1,2,3]);socket.send(binary);assert.equal(socket.sent[0],binary);
 assert.equal(vm.runInContext('_activeSocket',context),null,'status does not activate legacy JSON command senders');
 socket.fire('close');assert.equal(dot.dataset.status,'disconnected');
});
