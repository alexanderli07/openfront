'use strict';
function createPanelMotion({reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches}={}){
  const running=new WeakMap();
  function disclose(node,open,apply){
    const previous=node&&running.get(node);
    if(previous){running.delete(node);previous.cancel();}
    if(!node||reduced()||typeof node.animate!=='function'){apply();return;}
    if(open)apply();
    let animation;
    try{
      animation=node.animate(open?[{opacity:0,transform:'translateY(-4px)'},{opacity:1,transform:'translateY(0)'}]:
        [{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-4px)'}],
        {duration:open?170:130,easing:'ease-out'});
      running.set(node,animation);
      animation.finished.then(()=>{
        if(running.get(node)!==animation)return;
        running.delete(node);if(!open)apply();
      },()=>{
        if(running.get(node)!==animation)return;
        running.delete(node);if(!open)apply();
      });
    }catch{if(!open)apply();}
  }
  return {disclose};
}
if(typeof module!=='undefined'&&module.exports)module.exports=createPanelMotion;
