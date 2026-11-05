'use strict';
// The current game wire is binary. UI connection status must not depend on
// decoding outgoing packets or selecting a socket for legacy command helpers.
function createGameConnectionStatus({baseUrl,openState=1,onChange=()=>{}}={}){
 const sockets=new Set();let previous=false;
 function connected(){return [...sockets].some(socket=>socket.readyState===openState);}
 function notify(){
  const current=connected();if(current===previous)return;
  previous=current;try{onChange(current);}catch{}
 }
 function track(socket,address){
  try{
   const base=new URL(baseUrl),url=new URL(address,base);
   if(!['ws:','wss:'].includes(url.protocol)&&!String(address).startsWith('/'))return;
   if(url.hostname!==base.hostname&&!/(^|\.)openfront\.io$/i.test(url.hostname))return;
   if(!/^\/w\d+\/?$/.test(url.pathname))return;
   sockets.add(socket);
   socket.addEventListener('open',notify);
   socket.addEventListener('close',()=>{sockets.delete(socket);notify();});
   notify();
  }catch{}
 }
 return {track,connected};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createGameConnectionStatus;
