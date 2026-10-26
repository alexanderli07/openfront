'use strict';

function createBrainRuntime(deps) {
  const owners = new WeakMap();
  const declined = new WeakMap();
  const transportHeld = new WeakSet();
  const instrumented = new WeakSet();
  const activePlans = new WeakMap();
  const attackScopes = new WeakMap();
  const turnScopes = new WeakMap();
  const spawnScopes = new WeakMap();
  const spawnSites = new WeakMap();
  const navalScopes = new WeakMap();
  const strikeRankScopes = new WeakMap();
  const strikeProvenance = new WeakMap();
  const diplomacyParents = new WeakMap();
  const diplomacyStops = new WeakMap();
  const placementParents = new WeakMap();
  const buildingScopes = new WeakMap();
  const openingStructurePlans = new WeakMap();
  const boatOrigins = new WeakMap();
  const boatDestinations = new WeakMap();
  const warshipSites = new WeakMap();
  const warshipThreatSources = new WeakMap();
  const warshipPatrolScopes = new WeakMap();
  const socialScopes = new WeakMap();
  const socialRecipients = new WeakMap();
  const allianceEventScopes = new WeakMap();
  const transportReservations = new WeakMap();
  const reactiveQuotes=new WeakMap();
  const reactiveInFlight=new WeakSet();
  let current = null;
  const safe = (read, fallback = null) => { try { return read(); } catch { return fallback; } };
  const ruleMethods = {
    emojiBehavior:['maybeSendCasualEmoji'],
    structureBehavior: ['handleStructures', 'defensePostNeeded', 'isOnStructureCooldown',
      'isInPostSaveUpBlockedPhase', 'shouldBuildStructure', 'getPerceivedCost', 'getSaveUpTarget',
      'maybeSpawnStructure', 'findBestStructureToUpgrade', 'structureSpawnTile', 'samThreatLevels'],
    attackBehavior: ['maybeAttack', 'attackBestTarget', 'attackBots', 'getBotAttackMaxParallelism',
      'counterReady', 'hostileWaveRemaining', 'shieldThreatened', 'findIncomingAttackPlayer',
      'findTraitor', 'findVictim', 'findVeryWeakEnemy', 'hasReserveRatioTroops', 'hasTriggerRatioTroops',
      'findDistantBoatTarget', 'findDisconnectedBoatTarget', 'boatTargetTaken',
      'openingVetoes', 'openingVetoesTile', 'shouldAttack',
      'calculateBotAttackTroops', 'sendAttack', 'sendLandAttack', 'sendBoatAttack', 'maybeOpportunisticBoat'],
    nukeBehavior: ['maybeSendNuke', 'findBestNukeTarget', 'getPerceivedNukeCost', 'nukeSpendAllowed',
      'nukeTileScore', 'planSaturationSalvoFor', 'chooseNukeArc'],
    mirvBehavior: ['considerMIRV', 'selectWinFixMirvTarget', 'selectVictoryDenialTarget',
      'selectSteamrollStopTarget', 'wasRecentlyMirved'],
    warshipBehavior: ['maybeSpawnWarship', 'shouldCounterWarshipInfestation', 'smartWarshipPatrol', 'smartWarshipCombat'],
    allianceBehavior: ['getAllianceDecision', 'handleAllianceRequests', 'handleAllianceExtensionRequests', 'handleAllianceRequestsFromBots', 'incomingAllianceRequests']
  };

  function summarize(value, depth = 0) {
    return safe(() => summarizeValue(value, depth), '[telemetry unavailable]');
  }
  function summarizeValue(value, depth = 0) {
    if (value === null || typeof value !== 'object') return value;
    if (depth > 2) return '[details omitted]';
    if (Array.isArray(value)) return value.slice(0, 12).map(v => summarize(v, depth + 1));
    if (value instanceof Set) return { count: value.size, sample: [...value].slice(0, 12) };
    if (typeof value.isPlayer === 'function') {
      return { playerId: safe(() => value.id()), player: safe(() => value.isPlayer()),
        troops: safe(() => value.troops()), gold: safe(() => value.gold()), tiles: safe(() => value.numTilesOwned()) };
    }
    if (typeof value.tile === 'function') {
      return { unitId: safe(() => value.id()), type: safe(() => value.type()),
        tile: safe(() => value.tile()), level: safe(() => value.level()) };
    }
    const result = {};
    for (const key of Object.keys(value).slice(0, 12)) {
      if (key === '__src' || key === 'game' || key === 'mg') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && 'value' in descriptor && typeof descriptor.value !== 'function') result[key] = summarize(descriptor.value, depth + 1);
    }
    return result;
  }
  function snapshot(controller) {
    const game = controller.bot.mg;
    const player = game.myPlayer();
    const settings = deps.settings();
    const units = safe(() => player.units(), []);
    const counts = {};
    for (const unit of units) {
      const type = safe(() => unit.type(), 'unknown');
      const entry = counts[type] ||= { count: 0, levels: 0, building: 0 };
      entry.count++; entry.levels += Number(safe(() => unit.level(), 1));
      if (safe(() => unit.isUnderConstruction(), false)) entry.building++;
    }
    const attacks = list => list.slice(0, 12).map(a => ({ troops: safe(() => a.troops()),
      attacker: safe(() => a.attacker().id()), target: safe(() => a.target().id()) }));
    return {
      tick: game.ticks(), phase: game.inSpawnPhase() ? 'spawn' : 'play',
      self: { id: safe(() => player.id()), gold: safe(() => player.gold()), troops: safe(() => player.troops()),
        tiles: safe(() => player.numTilesOwned()), units: counts,
        incoming: attacks(safe(() => player.incomingAttacks(), [])), outgoing: attacks(safe(() => player.outgoingAttacks(), [])) },
      settings: { features: settings.features, difficulty: safe(() => game.config().gameConfig().difficulty),
        economyFirst: settings.economyFirst, winFixes: settings.winFixes, phasedOpening: settings.phasedOpening,
        combatReserveFloor: settings.combatReserveFloor, nukeIncomeMinutes: settings.nukeIncomeMinutes }
    };
  }
  function attach(bot) {
    if (owners.has(bot)) return owners.get(bot);
    const controller = { bot, lastTick: null, snapshot: null, proposalSequence: 0, ruleSequence: 0,
      observedRules: new Set(), missingRules: [], lastMessageTick: -Infinity };
    controller.history=safe(()=>deps.startHistory?.(bot));
    controller.commandGuard=deps.createCommandGuard?.();
    controller.spending=deps.createSpendingLedger?.();
    controller.samDevelopment=deps.createSamDevelopment?.();
    controller.supportObserver=deps.createSupportPosture?.();
    controller.supportSpending=deps.createSpendingLedger?.();
    controller.engine = deps.createEngine({ maxRecords: 5000, retainImportant: true, onRecord: entry => {
      safe(()=>controller.history?.observe(entry));
      if (entry.kind !== 'decision') return;
      const proposal = entry.candidates.find(c => c.id === entry.selectedId);
      const tick = entry.snapshot.tick;
      // Trace sampling and the protected history are independent of panel updates.
      if (tick - controller.lastMessageTick >= 10 || !proposal) {
        controller.lastMessageTick = tick;
        deps.log?.(`[Brain ${entry.strategy.id}] ${proposal ? proposal.kind : 'wait'}: ${entry.reason}`);
      }
    } });
    controller.engine.register(deps.createLegacyStrategy());
    // Register additional pure policies here; the executor/trace format stays unchanged.
    for (const strategy of deps.strategies || []) controller.engine.register(strategy);
    controller.engine.select(deps.defaultStrategy || 'legacy-v1');
    owners.set(bot, controller);
    if(current&&current!==controller)safe(()=>transportReservations.get(current)?.dispose?.());
    current = controller;
    controller.engine.record('session', { baselineVersion: '1.84.0', adapter: 'structure, attack, target, naval, landing and warship plans; sequential commands',
      note: 'Dispatch status is not confirmation from the game server.' });
    return controller;
  }
  function begin(bot) {
    const controller = owners.get(bot) || attach(bot);
    current = controller;
    if(deps.watchTransportIntents)safe(()=>transportCapacity(controller));
    const tick = bot.mg.ticks();
    if (tick !== controller.lastTick) {
      controller.lastTick = tick;
      controller.snapshot = safe(() => snapshot(controller), { tick, unavailable: true });
      safe(() => {
        const types=['City','Port','Factory','SAM Launcher','Missile Silo','Defense Post'];
        const counts=Object.fromEntries(types.map(type=>[type,controller.snapshot.self.units[type]||{count:0,levels:0,building:0}]));
        const signature=JSON.stringify(counts);
        if(signature!==controller.infrastructureSignature){
          const units=bot.player.units().filter(unit=>types.includes(unit.type()));
          controller.engine.record('infrastructure-change',{tick,snapshot:controller.snapshot,
            previous:controller.infrastructureCounts||null,counts,totalStructures:units.length,
            structures:units.slice(0,80).map(unit=>({id:unit.id(),type:unit.type(),tile:safe(()=>unit.tile()),
              level:safe(()=>unit.level(),1),building:safe(()=>unit.isUnderConstruction(),false)}))});
          controller.infrastructureSignature=signature;controller.infrastructureCounts=counts;
        }
      });
      controller.engine.record('observation', { snapshot: controller.snapshot });
    }
  }
  function attachBehaviors(bot) {
    const controller = owners.get(bot) || attach(bot);
    for (const [property, methods] of Object.entries(ruleMethods)) {
      const actor = bot[property];
      if (!actor) continue;
      owners.set(actor, controller);
      if (instrumented.has(actor)) continue;
      instrumented.add(actor);
      for (const name of methods) {
        const original = actor[name];
        if (typeof original !== 'function') { controller.missingRules.push(`${property}.${name}`); continue; }
        controller.observedRules.add(`${property}.${name}`);
        actor[name] = function (...args) {
          const callId = ++controller.ruleSequence;
          const tick = safe(() => bot.mg.ticks());
          controller.engine.record('rule-call', { callId, tick, module: property, rule: name, arguments: summarize(args) });
          const completed = (result, error) => safe(() => controller.engine.record('rule-result', {
            callId, tick, module: property, rule: name,
            result: summarize(result), ...(error ? { error: String(error?.message || error) } : {})
          }));
          try {
            const result = Reflect.apply(original, this, args);
            if (safe(() => typeof result?.then === 'function', false)) {
              Promise.resolve(result).then(value => completed(value), error => completed(undefined, error)).catch(() => {});
            } else completed(result);
            return result;
          } catch (error) { completed(undefined, error); throw error; }
        };
      }
    }
  }
  function transportCapacity(controller) {
    const tick=controller.bot.mg.ticks();
    const ships=controller.bot.player.units(deps.transportType).filter(ship=>ship.isActive());
    const ids=new Set(ships.map(ship=>ship.id()));
    let state=transportReservations.get(controller);
    if(!state){state={seen:ids,pending:[],emitting:false};transportReservations.set(controller,state);
      try {state.dispose=deps.watchTransportIntents?.(tile=>{
        if(!state.emitting&&deps.isCurrent(controller.bot)){
          state.pending.push({tile,manual:true,tick:controller.bot.mg.ticks()});
          controller.engine.record('transport-manual-request',{tile,pending:state.pending.length});
        }
      });}catch(error){transportReservations.delete(controller);throw error;}}
    else {for(const ship of ships)if(!state.seen.has(ship.id())&&state.pending.length){
      const tile=ship.targetTile(),index=state.pending.findIndex(ticket=>ticket.tile===tile);
      if(index>=0){state.pending.splice(index,1);
        controller.commandGuard?.acknowledge(tile,tick);
        controller.engine.record('transport-reservation-acknowledged',{tick,tile,unitId:ship.id()});}
    }state.seen=ids;}
    state.pending=state.pending.filter(ticket=>{
      if(ticket.inFlight||tick-ticket.tick<40)return true;
      controller.engine.record('transport-reservation-expired',{tick,tile:ticket.tile,manual:!!ticket.manual,
        age:tick-ticket.tick,reason:'No matching active transport observed within 40 ticks'});
      return false;
    });
    return {state,destinations:ships.map(ship=>safe(()=>ship.targetTile())).filter(tile=>tile!=null),facts:{active:ships.length,pending:state.pending.length,limit:2},
      available:ships.length+state.pending.length<2};
  }
  function submit(actor, source, kind, args, execute, transport=false,donation=false,validate=null) {
    transportHeld.delete(actor);
    const controller = owners.get(actor);
    if (!controller) throw new Error(`Unattached Auto-Bot command source: ${source}`);
    const game = controller.bot.mg;
    if (!deps.enabled() || !deps.isCurrent(controller.bot) || deps.isPublic(game)) {
      declined.set(actor, true);
      const eventScope=allianceEventScopes.get(actor);if(eventScope)eventScope.stopped=true;
      controller.engine.record('blocked', { tick: game.ticks(), source, reason: 'Bot stopped, stale owner, or public lobby' });
      return false;
    }
    // No live game objects or executable callbacks are passed to the strategy.
    const state = !activePlans.has(actor) && controller.snapshot?.tick === game.ticks() ? controller.snapshot : safe(() => snapshot(controller), { tick: game.ticks(), unavailable: true });
    const proposal = { id: `command-${++controller.proposalSequence}`, kind, source, arguments: summarize(args),
      ...(activePlans.has(actor) ? { parentDecisionId: activePlans.get(actor) } : {}) };
    if(transport){
      try {const capacity=transportCapacity(controller);proposal.eligible=capacity.available;
        if(!capacity.available)transportHeld.add(actor);
        proposal.transportCapacity=capacity.facts;proposal.reason=capacity.available?
          'Automatic transport capacity available':'Keep the third transport slot for manual use';}
      catch(error){declined.set(actor,true);controller.engine.record('blocked',{source,reason:'Transport capacity unavailable',error:String(error?.message||error)});return false;}
    }
    if(validate){const facts=validate();proposal.eligible=proposal.eligible!==false&&facts.allowed;proposal.spending=facts;
      if(!facts.allowed)transportHeld.add(actor);}
    let executed = false;
    try {
      return controller.engine.submit(state, proposal, () => {
        if(validate&&!validate().allowed){transportHeld.add(actor);return false;}
        let reservation,capacity;
        if(transport){capacity=transportCapacity(controller);if(!capacity.available){transportHeld.add(actor);return false;}}
        const release=()=>{if(reservation){const index=capacity.state.pending.indexOf(reservation);if(index>=0)capacity.state.pending.splice(index,1);}};
        const emit=()=>{if(transport){reservation={tile:args[0],tick:game.ticks(),inFlight:true};capacity.state.pending.push(reservation);}
        try {executed=true;if(transport)capacity.state.emitting=true;const result=execute();if(result===false)release();
          const settled=value=>{if(reservation){reservation.inFlight=false;reservation.tick=game.ticks();}if(value===false)release();};
          if(result&&typeof result.then==='function')Promise.resolve(result).then(settled,release);
          else settled(result);
          return result;
        }catch(error){release();throw error;}finally{if(transport)capacity.state.emitting=false;}};
        if(controller.commandGuard&&(transport||donation)){
          let result;
          const guarded=controller.commandGuard.dispatch({kind:transport?'boat':'donation',
            key:transport?args[0]:args[0].id(),tick:game.ticks(),activeBoatDestinations:capacity?.destinations,
            emit:()=>{result=emit();return result;}});
          if(guarded.hold==='operational'){
            transportHeld.add(actor);controller.engine.record('command-operational-hold',{tick:game.ticks(),kind,
              reason:guarded.reason,destination:transport?args[0]:undefined,recipient:donation?args[0].id():undefined});
          }
          return guarded.emitted?result:false;
        }
        return emit();
      });
    } finally { declined.set(actor, !executed);if(!executed&&!transportHeld.has(actor)){const scope=allianceEventScopes.get(actor);if(scope)scope.stopped=true;} }
  }
  function intent(actor, source, ctor, ...args) {
    const kind = safe(() => deps.intentName?.(ctor)) || 'intent';
    const transport=deps.isTransportIntent?.(ctor)===true,donation=deps.isDonationIntent?.(ctor)===true||kind==='donateTroops';
    const controller=owners.get(actor);
    const request=()=>{
      const p=supportPosture(actor);if(!p)return {allowed:true};
      if(p.conserve||donation&&!(p.donationReady??p.ready))return {allowed:false,reason:p.donationHoldReason||p.reason};
      if(!p.ready&&!donation||!controller.supportSpending)return {allowed:true};
      const troops=controller.bot.player.troops(),capacity=controller.bot.mg.config().maxTroops(controller.bot.player),amount=args[1];
      if(!Number.isFinite(troops)||!Number.isFinite(capacity)||!Number.isFinite(amount)||amount<=0)return {allowed:false,reason:'Invalid support troop quote'};
      const q={tick:controller.bot.mg.ticks(),gold:BigInt(Math.floor(troops)),cost:BigInt(Math.ceil(amount)),
        reserve:BigInt(Math.ceil(capacity*p.keepFraction)),key:donation?`donation:${controller.bot.mg.ticks()}`:`boat:${args[0]}`};
      return {...controller.supportSpending.facts(q),...q,reason:'Keep home troop reserve and pending support commitments'};
    };
    const execute=()=>{
      const q=transport||donation?request():{allowed:true};
      if(!q.allowed)return false;
      return q.cost!==undefined?controller.supportSpending.commit(q,()=>deps.emitIntent(ctor,...args)):deps.emitIntent(ctor,...args);
    };
    return submit(actor,source,kind,args,execute,transport,donation,transport||donation?request:null);
  }
  function socialHooks(actor){
    const controller=owners.get(actor);
    if(!controller||!deps.socialPlanner)throw new Error('Social planner is not attached');
    return {
      allowed:()=>!socialScopes.get(actor)?.stopped&&deps.enabled()&&deps.isCurrent(controller.bot)&&!deps.isPublic(controller.bot.mg),
      hold:()=>{let scope=socialScopes.get(actor);if(scope){for(const undo of [...(scope.undos||[])].reverse())undo();scope.undos=[];}while(scope){scope.stopped=true;scope=scope.parent;}},
      undo:run=>socialScopes.get(actor)?.undos?.push(run),
      choose:(domain,candidates,facts)=>controller.engine.decide({...safe(()=>snapshot(controller),{unavailable:true}),domain,social:facts,
        ...(activePlans.has(actor)?{parentDecisionId:activePlans.get(actor)}:{})},candidates),
      remember:id=>socialRecipients.set(actor,id),
      record:(kind,details)=>controller.engine.record(kind,details),
      execute:(id,run)=>{const previous=activePlans.get(actor);activePlans.set(actor,id);try{return run();}finally{if(previous===undefined)activePlans.delete(actor);else activePlans.set(actor,previous);}}
    };
  }
  function planSocial(actor){
    const previous=socialScopes.get(actor);socialScopes.set(actor,{stopped:false});
    try{return deps.socialPlanner.casual(actor,socialHooks(actor));}finally{if(previous===undefined)socialScopes.delete(actor);else socialScopes.set(actor,previous);socialRecipients.delete(actor);}
  }
  function selectSocialRecipient(actor,pool,mode){
    socialRecipients.delete(actor);
    return deps.socialPlanner.recipient(actor,pool,mode,socialHooks(actor));
  }
  function socialRecipientAction(actor,run){
    const id=socialRecipients.get(actor);socialRecipients.delete(actor);
    return id===undefined?run():socialHooks(actor).execute(id,run);
  }
  function planSmallAttackEmoji(actor,attacks,troops,emoji){
    return socialRequestScope(actor,()=>deps.socialPlanner.smallAttacks(actor,attacks,troops,emoji,socialHooks(actor)));
  }
  function socialRequestScope(actor,run){
    const previous=socialScopes.get(actor),scope={stopped:Boolean(previous?.stopped),parent:previous,undos:[]};socialScopes.set(actor,scope);
    try{return run();}finally{if(!socialHooks(actor).allowed())socialHooks(actor).hold();if(previous===undefined)socialScopes.delete(actor);else socialScopes.set(actor,previous);}
  }
  function planEmojiRequest(actor,target,pool,attack,options){return socialRequestScope(actor,()=>deps.socialPlanner.request(actor,target,pool,attack,options,socialHooks(actor)));}
  function planSocialWinner(actor,run){return socialRequestScope(actor,run);}
  function markSocialWinner(actor){return deps.socialPlanner.winnerMark(actor,socialHooks(actor));}
  function emojiPermission(actor,target,mark,options){return deps.socialPlanner.permission(actor,target,mark,options,socialHooks(actor));}
  function selectSocialMessage(actor,pool){return deps.socialPlanner.message(actor,pool,socialHooks(actor));}
  function selectSocialPool(actor,pools,sample,mode){return deps.socialPlanner.pool(pools,sample,mode,socialHooks(actor));}
  function planSocialReaction(actor,run){return socialRequestScope(actor,()=>deps.socialPlanner.reaction(actor,run,socialHooks(actor)));}
  function planAllianceEvents(actor,mode,action,run,request){
    const controller=owners.get(actor);if(!controller||!deps.allianceEventPlanner)throw new Error('Alliance event planner is not attached');
    const previous=allianceEventScopes.get(actor),scope=previous||{stopped:false};allianceEventScopes.set(actor,scope);
    declined.delete(actor);diplomacyParents.delete(actor);
    try{const hooks={
      allowed:()=>!scope.stopped&&deps.enabled()&&deps.isCurrent(controller.bot)&&!deps.isPublic(controller.bot.mg),
      hold:()=>{scope.stopped=true;diplomacyParents.delete(actor);},
      choose:(domain,candidates,facts)=>controller.engine.decide({...safe(()=>snapshot(controller),{unavailable:true}),domain,event:facts,
        ...(facts.parentDecisionId!==undefined||activePlans.has(actor)?{parentDecisionId:facts.parentDecisionId??activePlans.get(actor)}:{})},candidates),
      record:(kind,details)=>controller.engine.record(kind,details),
      allianceStopped:()=>diplomacyStops.get(actor)===true,
      ruleParent:context=>diplomacyParents.get(actor)?.context===context?diplomacyParents.get(actor).decisionId:undefined,
      parent:()=>activePlans.get(actor),
      link:(context,id)=>diplomacyParents.set(actor,{context,decisionId:id}),
      wasDeclined:()=>declined.get(actor)===true&&!transportHeld.has(actor),
      execute:(id,run)=>{const old=activePlans.get(actor);activePlans.set(actor,id);declined.delete(actor);diplomacyStops.delete(actor);try{return run();}finally{if(old===undefined)activePlans.delete(actor);else activePlans.set(actor,old);}}
    };return mode==='action'?deps.allianceEventPlanner.action(actor,action,run,hooks,request):deps.allianceEventPlanner.run(actor,mode,hooks);
    }finally{if(!previous)allianceEventScopes.delete(actor);diplomacyParents.delete(actor);}
  }
  function allianceEventStopped(actor){
    const controller=owners.get(actor);
    return allianceEventScopes.get(actor)?.stopped===true||declined.get(actor)===true||!deps.enabled()||!controller||!deps.isCurrent(controller.bot)||deps.isPublic(controller.bot.mg);
  }
  function build(actor, source, menu, ...args) {
    const bu = args[0];
    const kind = safe(() => typeof bu?.canUpgrade === 'number' ? 'upgrade' : `build ${bu?.type || 'unit'}`, 'build');
    const placementDecisionId = bu && typeof bu === 'object' ? placementParents.get(bu) : undefined;
    const controller=owners.get(actor),adaptive=controller?.engine.selectedStrategy?.()==='adaptive-v1';
    const port=!!deps.portWaterAccess&&bu?.type===deps.units?.Port;
    const request=()=>{
      if(port){
        const tile=typeof bu.canUpgrade==='number'?
          controller.bot.player.units(deps.units.Port).find(unit=>unit.id()===bu.canUpgrade)?.tile():bu.canBuild;
        if(typeof tile!=='number')return {allowed:false,reason:'Port site cannot be verified'};
        const water=deps.portWaterAccess.assess(controller.bot.mg,tile);
        if(!water.allowed)return {allowed:false,reason:water.reason};
      }
      if(adaptive&&(deps.buildAllowed?.(bu.type)===false||controller.bot.mg.config().isUnitDisabled?.(bu.type)===true))
        return {allowed:false,reason:'Building type disabled before final dispatch'};
      const facts=defenseEconomyFacts(actor),upgrade=typeof bu?.canUpgrade==='number';
      const proof=reactiveQuotes.get(bu);
      if(adaptive&&upgrade&&bu.type===deps.units?.SAMLauncher&&(!proof||proof.tick!==controller.bot.mg.ticks()))
        return {allowed:false,reason:'SAM upgrades require a fresh central defense decision'};
      if(!facts||!controller.spending)return {allowed:true};
      const cost=upgrade?(bu.upgradeCosts?.[0]??bu.cost):bu.cost;
      const replacement=!upgrade&&bu.type===deps.units?.SAMLauncher&&facts.stage==='first-sam'&&!facts.waitingForSam;
      let reserve=proof?(proof.mode==='planned'?proof.protectedReserve:0n):replacement?0n:facts.reserve;
      if(!replacement&&!proof&&facts.stage!=='reserve'&&facts.requiredType&&bu.type!==facts.requiredType){
        const structure=controller.bot.structureBehavior;
        const requiredCost=structure?.cost?.(facts.requiredType);
        if(typeof requiredCost==='bigint'&&requiredCost>reserve)reserve=requiredCost;
      }
      const key=replacement?`${bu.type}:replacement`:`${bu.type}:${upgrade?'upgrade:'+bu.canUpgrade:'build:'+bu.canBuild}`;
      return {...controller.spending.facts({tick:controller.bot.mg.ticks(),gold:controller.bot.player.gold(),
        cost,reserve,key}),key,tick:controller.bot.mg.ticks()};
    };
    const execute=()=>{
      const facts=request();
      if(!facts.allowed)return false;
      if(facts.cost!==undefined&&controller.spending)return controller.spending.commit(facts,
        ()=>Reflect.apply(menu.sendBuildOrUpgrade, menu, args));
      return Reflect.apply(menu.sendBuildOrUpgrade, menu, args);
    };
    if (placementDecisionId === undefined) {
      return submit(actor, source, kind, args, execute,false,false,adaptive||port?request:null);
    }
    placementParents.delete(bu);
    return withPlan(actor, placementDecisionId,
      () => submit(actor, source, kind, args, execute,false,false,adaptive||port?request:null));
  }
  function callback(actor, source, receiver, method, ...args) {
    return submit(actor, source, source.split('.').at(-1), args, () => Reflect.apply(receiver[method], receiver, args));
  }
  function withDiplomacyParent(actor, context, execute) {
    const pending = diplomacyParents.get(actor);
    if (!pending || pending.context !== context) return execute();
    const previous = activePlans.get(actor);
    diplomacyParents.delete(actor);
    activePlans.set(actor, pending.decisionId);
    try { return execute(); }
    finally {
      if (previous === undefined) activePlans.delete(actor);
      else activePlans.set(actor, previous);
    }
  }
  function diplomacyIntent(actor, context, source, ctor, ...args) {
    return withDiplomacyParent(actor, context, () => intent(actor, source, ctor, ...args));
  }
  function diplomacyCallback(actor, context, source, receiver, method, ...args) {
    return withDiplomacyParent(actor, context, () => callback(actor, source, receiver, method, ...args));
  }
  function decideAlliance(actor, target, incoming, context) {
    const controller = owners.get(actor);
    if (!controller || !deps.diplomacyPlanner) throw new Error('Diplomacy planner is not attached');
    diplomacyParents.delete(actor);
    diplomacyStops.set(actor, false);
    const allowed = () => deps.enabled() && deps.isCurrent(controller.bot) && !deps.isPublic(controller.bot.mg) && !attackScopes.get(actor)?.stopped;
    const result = deps.diplomacyPlanner.decide(actor, target, incoming, {
      allowed,
      choose: (domain, candidates, facts) => controller.engine.decide({
        ...safe(() => snapshot(controller), { unavailable: true }), domain, diplomacy: facts,
        ...(activePlans.has(actor) ? { parentDecisionId: activePlans.get(actor) } : {})
      }, candidates),
      record: (kind, details) => controller.engine.record(kind, details),
      execute: (decisionId, execute) => {
        const previous = activePlans.get(actor);
        activePlans.set(actor, decisionId);
        try { return execute(); }
        finally {
          if (previous === undefined) activePlans.delete(actor);
          else activePlans.set(actor, previous);
        }
      }
    });
    diplomacyStops.set(actor, result.stopped);
    if (result.stopped && attackScopes.has(actor)) {
      attackScopes.get(actor).stopped = true;
      controller.engine.record('attack-stop', { decisionId: result.decisionId, reason: 'Alliance rule stopped the enclosing attack sequence' });
    }
    if (!result.stopped && result.decisionId !== null &&
        (context === 'incoming' || result.accepted && (context === 'renewal' || context === 'outgoing'))) {
      diplomacyParents.set(actor, { context, decisionId: result.decisionId });
    }
    return result.accepted;
  }
  function diplomacyDetailsHooks(actor) {
    const controller=owners.get(actor);
    if(!controller||!deps.diplomacyDetailsPlanner)throw new Error('Diplomacy details planner is not attached');
    return {
      supportPosture:()=>supportPosture(actor),
      allowed:()=>deps.enabled()&&deps.isCurrent(controller.bot)&&!deps.isPublic(controller.bot.mg)&&!attackScopes.get(actor)?.stopped,
      choose:(domain,candidates,facts)=>controller.engine.decide({
        ...safe(()=>snapshot(controller),{unavailable:true}),domain,diplomacy:facts,
        ...(activePlans.has(actor)?{parentDecisionId:activePlans.get(actor)}:{})
      },candidates),
      record:(kind,details)=>controller.engine.record(kind,details),
      hold:()=>{const scope=attackScopes.get(actor);if(scope)scope.stopped=true;},
      wasDeclined:()=>declined.get(actor)===true&&!transportHeld.has(actor),
      allianceStopped:()=>diplomacyStops.get(actor)===true,
      execute:(decisionId,execute)=>{
        const previous=activePlans.get(actor);activePlans.set(actor,decisionId);
        declined.delete(actor);diplomacyStops.delete(actor);
        try{return execute();}finally{
          if(previous===undefined)activePlans.delete(actor);else activePlans.set(actor,previous);
        }
      }
    };
  }
  function planDonation(actor,targets) {
    return deps.diplomacyDetailsPlanner.donate(actor,targets,diplomacyDetailsHooks(actor));
  }
  function planAttackAllocation(actor,mode,target,value) {
    const controller=owners.get(actor);
    if(!controller||!deps.attackAllocationPlanner)throw new Error('Attack allocation planner is not attached');
    const previousScope=attackScopes.get(actor),scope=previousScope||{stopped:false};
    const budget=actor.botAttackTroopsSent;
    if(!previousScope)attackScopes.set(actor,scope);
    const hooks={
      allowed:()=>deps.enabled()&&deps.isCurrent(controller.bot)&&!deps.isPublic(controller.bot.mg)&&!scope.stopped,
      setBotMinimum:minimum=>{scope.botMinimum=minimum;},
      minimumBotForce:()=>scope.botMinimum??0,
      choose:(domain,candidates,facts)=>controller.engine.decide({
        ...safe(()=>snapshot(controller),{unavailable:true}),domain,allocation:facts,
        ...(domain==='opening-expansion'?{openingExpansion:facts}:{}),
        ...(activePlans.has(actor)?{parentDecisionId:activePlans.get(actor)}:{})
      },candidates),
      hold:()=>{scope.stopped=true;},
      record:(kind,details)=>controller.engine.record(kind,details),
      wasDeclined:()=>declined.get(actor)===true,
      execute:(decisionId,execute)=>{
        const previous=activePlans.get(actor);activePlans.set(actor,decisionId);declined.delete(actor);
        try{return execute();}finally{if(previous===undefined)activePlans.delete(actor);else activePlans.set(actor,previous);}
      }
    };
    try{
      if(mode==='land'&&!value&&!target.isPlayer()&&deps.openingExpansion){
        const opening=deps.openingExpansion.run(actor,target,openingFacts(actor),hooks);
        if(opening!==undefined)return opening.result;
      }
      return deps.attackAllocationPlanner[mode](actor,target,...(mode==='forced'?[]:[value]),hooks);
    }
    finally{
      if(scope.stopped)actor.botAttackTroopsSent=budget;
      if(!previousScope)attackScopes.delete(actor);
    }
  }
  function attackRoutingHooks(actor) {
    const controller=owners.get(actor);
    if(!controller||!deps.attackRoutingPlanner)throw new Error('Attack routing planner is not attached');
    const scope=attackScopes.get(actor)||{stopped:false},parent=activePlans.get(actor);
    return {
      allowed:()=>deps.enabled()&&deps.isCurrent(controller.bot)&&!deps.isPublic(controller.bot.mg)&&!scope.stopped,
      stopped:()=>scope.stopped,
      hold:()=>{scope.stopped=true;},
      minimumBotForce:()=>scope.botMinimum??0,
      wasDeclined:()=>declined.get(actor)===true&&!transportHeld.has(actor),
      choose:(domain,candidates,facts,parentId=parent)=>controller.engine.decide({
        ...safe(()=>snapshot(controller),{unavailable:true}),domain,routing:facts,
        ...(parentId!==undefined?{parentDecisionId:parentId}:{})
      },candidates),
      record:(kind,details)=>controller.engine.record(kind,details),
      probe:tile=>deps.probeLanding(actor,tile,false),
      // Async children capture these IDs/scopes on entry. Restore immediately,
      // so no shared active parent remains installed during worker awaits.
      execute:(decisionId,execute)=>{
        const previousParent=activePlans.get(actor),previousScope=attackScopes.get(actor);
        activePlans.set(actor,decisionId);attackScopes.set(actor,scope);declined.delete(actor);
        try{return execute();}finally{
          if(previousParent===undefined)activePlans.delete(actor);else activePlans.set(actor,previousParent);
          if(previousScope===undefined)attackScopes.delete(actor);else attackScopes.set(actor,previousScope);
        }
      }
    };
  }
  function planAttackRoute(actor,target,counter) {
    return deps.attackRoutingPlanner.route(actor,target,counter,attackRoutingHooks(actor));
  }
  function planTargetedBoat(actor,target) {
    return deps.attackRoutingPlanner.targeted(actor,target,attackRoutingHooks(actor));
  }
  function planFreeBoat(actor,tiles) {
    return deps.attackRoutingPlanner.free(actor,tiles,attackRoutingHooks(actor));
  }
  function planEmbargos(actor,targets,context) {
    const controller=owners.get(actor);
    if(!controller||!deps.embargoPlanner)throw new Error('Embargo planner is not attached');
    const turn=turnScopes.get(controller.bot);let stopped=false;
    context={...context,nativeAll:context.team&&controller.engine.selectedStrategy?.()==='adaptive-v1'};
    const hooks={
      botType:deps.botType,
      sendAll:()=>{
        const ctor=deps.embargoAllCtor?.();
        if(typeof ctor!=='function')throw new Error('Native embargo-all constructor unavailable');
        return intent(actor,'NationBot',ctor,'start');
      },
      allowed:()=>!stopped&&!turn?.stopped&&deps.enabled()&&deps.isCurrent(controller.bot)&&!deps.isPublic(controller.bot.mg),
      stopped:()=>stopped,
      hold:()=>{stopped=true;if(turn)turn.stopped=true;},
      choose:(domain,candidates,facts)=>controller.engine.decide({
        ...safe(()=>snapshot(controller),{unavailable:true}),domain,embargo:facts,
        ...(activePlans.has(actor)?{parentDecisionId:activePlans.get(actor)}:{})
      },candidates),
      record:(kind,details)=>controller.engine.record(kind,details),
      wasDeclined:()=>declined.get(actor)===true,
      execute:(decisionId,execute)=>{
        const previous=activePlans.get(actor);activePlans.set(actor,decisionId);declined.delete(actor);
        try{return execute();}finally{if(previous===undefined)activePlans.delete(actor);else activePlans.set(actor,previous);}
      }
    };
    return deps.embargoPlanner.run(actor,targets,context,hooks);
  }
  function planSpawn(actor,mode,tick) {
    const controller=owners.get(actor);
    if(!controller||!deps.spawnPlanner)throw new Error('Spawn planner is not attached');
    const previousScope=spawnScopes.get(actor),scope=previousScope||{stopped:false};
    if(!previousScope)spawnScopes.set(actor,scope);
    const hooks={
      allowed:()=>!scope.stopped&&deps.enabled()&&deps.isCurrent(controller.bot)&&!deps.isPublic(controller.bot.mg),
      stopped:()=>scope.stopped,hold:()=>{scope.stopped=true;},
      wasDeclined:()=>declined.get(actor)===true,
      clearSite:()=>spawnSites.delete(actor),remember:(tile,decisionId)=>spawnSites.set(actor,{tile,decisionId}),
      siteParent:()=>spawnSites.get(actor)?.decisionId??activePlans.get(actor),
      choose:(domain,candidates,facts)=>controller.engine.decide({
        ...safe(()=>snapshot(controller),{unavailable:true}),domain,spawn:facts,
        ...(activePlans.has(actor)?{parentDecisionId:activePlans.get(actor)}:{})
      },candidates),
      record:(kind,details)=>controller.engine.record(kind,details),
      execute:(decisionId,execute)=>{
        const previous=activePlans.get(actor);if(decisionId!==undefined)activePlans.set(actor,decisionId);declined.delete(actor);
        try{return execute();}finally{if(previous===undefined)activePlans.delete(actor);else activePlans.set(actor,previous);}
      }
    };
    try{return deps.spawnPlanner[mode](actor,...(mode==='tick'?[tick]:[]),hooks);}
    finally{if(!previousScope){spawnScopes.delete(actor);spawnSites.delete(actor);}}
  }
  function planAllianceOutreach(actor,targets) {
    return deps.diplomacyDetailsPlanner.outreach(actor,targets,diplomacyDetailsHooks(actor));
  }
  function planFarOutreach(actor,targets,now,ctors) {
    return deps.diplomacyDetailsPlanner.far(actor,targets,now,ctors,diplomacyDetailsHooks(actor));
  }
  async function withCombatDiplomacyPlan(actor, decisionId, execute) {
    const alliance = actor.allianceBehavior;
    const previousActor = activePlans.get(actor);
    const previousAlliance = alliance ? activePlans.get(alliance) : undefined;
    activePlans.set(actor, decisionId);
    if (alliance) activePlans.set(alliance, decisionId);
    try { return await execute(); }
    finally {
      if (previousActor === undefined) activePlans.delete(actor); else activePlans.set(actor, previousActor);
      if (alliance) {
        if (previousAlliance === undefined) activePlans.delete(alliance); else activePlans.set(alliance, previousAlliance);
      }
    }
  }
  function combatDiplomacyHooks(actor) {
    const controller = owners.get(actor);
    if (!controller || !deps.diplomacyPlanner) throw new Error('Combat diplomacy planner is not attached');
    return {
      allowed: () => deps.enabled() && deps.isCurrent(controller.bot) && !deps.isPublic(controller.bot.mg) && !attackScopes.get(actor)?.stopped,
      choose: (domain, candidates, facts) => controller.engine.decide({
        ...safe(() => snapshot(controller), { unavailable: true }), domain, diplomacy: facts,
        ...(activePlans.has(actor) ? { parentDecisionId: activePlans.get(actor) } : {})
      }, candidates),
      record: (kind, details) => controller.engine.record(kind, details),
      execute: (decisionId, execute) => withCombatDiplomacyPlan(actor, decisionId, execute)
    };
  }
  function finishCombatDiplomacy(actor, hooks, result, purpose) {
    if (result.stopped) {
      const scope = attackScopes.get(actor);
      if (scope) scope.stopped = true;
      hooks.record('attack-stop', { decisionId: result.decisionId, purpose,
        reason: 'Combat diplomacy policy stopped the enclosing attack pass' });
    }
    return result.completed;
  }
  async function planAssist(actor) {
    const hooks = combatDiplomacyHooks(actor);
    const result = await deps.diplomacyPlanner.assist(actor, hooks);
    return finishCombatDiplomacy(actor, hooks, result, 'assist');
  }
  async function planBetray(actor, friends, enemies) {
    const hooks = combatDiplomacyHooks(actor);
    const result = await deps.diplomacyPlanner.betray(actor, friends, enemies, hooks);
    return finishCombatDiplomacy(actor, hooks, result, 'betray');
  }
  async function withPlan(actor, decisionId, execute) {
    const previous = activePlans.get(actor);
    activePlans.set(actor, decisionId);
    try { return await execute(); }
    finally {
      if (previous === undefined) activePlans.delete(actor);
      else activePlans.set(actor, previous);
    }
  }
  async function withTurnPlan(bot, decisionId, execute) {
    const actors = [...new Set([bot, bot.emojiBehavior, bot.allianceBehavior, bot.mirvBehavior,
      bot.structureBehavior, bot.warshipBehavior, bot.attackBehavior, bot.nukeBehavior].filter(Boolean))];
    const previous = actors.map(actor => ({ actor, had: activePlans.has(actor), value: activePlans.get(actor) }));
    for (const actor of actors) activePlans.set(actor, decisionId);
    try { return await execute(); }
    finally {
      for (const entry of previous) {
        if (entry.had) activePlans.set(entry.actor, entry.value);
        else activePlans.delete(entry.actor);
      }
    }
  }
  function turnHooks(bot) {
    const controller = owners.get(bot);
    if (!controller || !deps.turnPlanner) throw new Error('Turn planner is not attached');
    return {
      allowed: () => deps.enabled() && deps.isCurrent(controller.bot) && !deps.isPublic(controller.bot.mg) && !turnScopes.get(bot)?.stopped,
      choose: (domain, candidates, facts) => controller.engine.decide({
        ...safe(() => snapshot(controller), { unavailable: true }), domain, turn: facts,
        teamNaval: teamNavalFacts(bot.warshipBehavior || bot),
        ...(activePlans.has(bot) ? { parentDecisionId: activePlans.get(bot) } : {})
      }, candidates),
      execute: (decisionId, execute) => withTurnPlan(bot, decisionId, execute),
      record: (kind, details) => controller.engine.record(kind, details)
    };
  }
  async function planTurn(bot, context) {
    const previous=turnScopes.get(bot);
    if(!previous)turnScopes.set(bot,{stopped:false});
    try{return await deps.turnPlanner.run(bot, context, turnHooks(bot));}
    finally{if(!previous)turnScopes.delete(bot);}
  }
  function warshipCombatHooks(actor, planner = deps.warshipCombatPlanner) {
    const controller = owners.get(actor);
    if (!controller || !planner) throw new Error('Warship planner is not attached');
    return {
      allowed: () => !warshipPatrolScopes.get(actor)?.stopped && deps.enabled() && deps.isCurrent(controller.bot) && !deps.isPublic(controller.bot.mg),
      choose: (domain, candidates, facts, parentDecisionId = activePlans.get(actor)) => controller.engine.decide({
        ...safe(() => snapshot(controller), { unavailable: true }), domain, warship: facts,
        teamNaval: teamNavalFacts(actor),
        ...(parentDecisionId === undefined ? {} : { parentDecisionId })
      }, candidates),
      remember: decisionId => warshipSites.set(actor, decisionId),
      wasDeclined: () => declined.get(actor) === true,
      hold: () => { const scope = warshipPatrolScopes.get(actor); if (scope) {scope.stopped = true;scope.onHold?.();} },
      record: (kind, details) => controller.engine.record(kind, details),
      execute: (decisionId, execute) => {
        const previous = activePlans.get(actor);
        activePlans.set(actor, decisionId);
        declined.delete(actor);
        try { return execute(); }
        finally {
          if (declined.get(actor) === true) {
            const scope = warshipPatrolScopes.get(actor);
            if (scope) scope.stopped = true;
          }
          if (previous === undefined) activePlans.delete(actor);
          else activePlans.set(actor, previous);
        }
      }
    };
  }
  function tradeAreasEnabled(actor){
    return !!deps.warshipTradeHotspots&&owners.get(actor)?.engine.selectedStrategy?.()==='adaptive-v1'&&deps.settings().warshipHuntTrade!==false;
  }
  function planWarshipCombat(actor, context) {
    if (deps.teamGeography) context = { ...context, transports: deps.teamGeography.transportTargets(actor.game, actor.player, context.ship) };
    const hooks = warshipCombatHooks(actor);
    if(tradeAreasEnabled(actor)){
      const last=context.smart.cooldown.get(context.ship.id()),tick=actor.game.ticks();
      const ready=last===undefined||tick<last||tick-last>=60;
      const posted=deps.warshipTradeHotspots.posted?.(actor,context.ship);
      const hotspotCandidates=ready&&context.hunt?deps.warshipTradeHotspots.rank(actor,context.ship):[];
      context={...context,hotspotMode:true,hotspotCandidates,coastalDefense:ready&&context.hunt&&!hotspotCandidates.length?deps.warshipTradeHotspots.coastalDefense?.(actor,context.ship):null};
      if(posted&&!context.coastalDefense)context={...context,transports:(context.transports||[]).filter(t=>t.landingDistance<=40&&t.interceptDistance<=60)};
      hooks.assigned=area=>{
        const changed=deps.warshipTradeHotspots.assign(actor,context.ship,area);
        if(area.reviewed)hooks.record('warship-post-review',{unitId:context.ship.id(),tile:area.tile,key:area.key,clearance:area.clearance,reviewedAt:area.reviewedAt,viable:true});
        if(changed)hooks.record('warship-hotspot-assignment',{unitId:context.ship.id(),tile:area.tile,key:area.key,
          density:area.density,score:area.score,retained:area.retained,occupancy:area.occupancy,protectionUnknown:area.protectionUnknown,clearance:area.clearance,reviewedAt:area.reviewedAt,teamDistance:area.teamDistance,enemyDistance:area.enemyDistance});
      };
      hooks.defended=area=>{
        if(deps.warshipTradeHotspots.coastalAssigned(actor,context.ship,area))hooks.record('warship-coastal-assignment',{
          unitId:context.ship.id(),tile:area.tile,coastTile:area.coastTile,teamDistance:area.teamDistance});
      };
      hooks.move=(ship,tile)=>{
        const ctor=deps.warshipMoveCtor?.();
        if(typeof ctor!=='function')throw new Error('Native warship move constructor unavailable');
        return intent(actor,'WarshipBehavior',ctor,[ship.id()],tile);
      };
    }
    hooks.waypoint = (start,home,enemies) => {
      warshipSites.delete(actor);
      const tile=actor.findSafeWaypoint(start,home,enemies);
      return {tile,decisionId:warshipSites.get(actor) ?? activePlans.get(actor)};
    };
    const run=()=>deps.warshipCombatPlanner.combat(actor, context, hooks);
    return context.homeDecisionId===undefined?run():hooks.execute(context.homeDecisionId,run);
  }
  function selectWarshipHome(actor,ship) {
    return deps.warshipSafetyPlanner.home(actor,ship,warshipCombatHooks(actor,deps.warshipSafetyPlanner));
  }
  function selectWarshipNukeEscape(actor,x,y,zones,eta) {
    return deps.warshipSafetyPlanner.escape(actor,x,y,zones,eta,warshipCombatHooks(actor,deps.warshipSafetyPlanner));
  }
  function planWarshipNukeDodge(actor,ships,context) {
    const hooks=warshipCombatHooks(actor,deps.warshipSafetyPlanner);
    hooks.escape=(x,y,zones,eta)=>{
      warshipSites.delete(actor);
      const selection=actor.findNukeEscapeTile(x,y,zones,eta);
      return {selection,decisionId:warshipSites.get(actor)??activePlans.get(actor)};
    };
    return deps.warshipSafetyPlanner.dodge(actor,ships,context,hooks);
  }
  function selectWarshipWaypoint(actor,start,home,enemies) {
    return deps.warshipCombatPlanner.waypoint(actor,start,home,enemies,warshipCombatHooks(actor));
  }
  function planWarshipRetaliation(actor, tile, target, cause, onDecline) {
    const hooks = warshipCombatHooks(actor);
    if(onDecline){
      const hold=hooks.hold,execute=hooks.execute;
      hooks.hold=()=>{hold();onDecline();};
      hooks.execute=(decisionId,action)=>{
        const previous=warshipPatrolScopes.get(actor),scope={stopped:false,onHold:onDecline};
        warshipPatrolScopes.set(actor,scope);
        try{return execute(decisionId,action);}
        finally{
          if(scope.stopped||declined.get(actor)===true)onDecline();
          if(previous===undefined)warshipPatrolScopes.delete(actor);else warshipPatrolScopes.set(actor,previous);
        }
      };
    }
    return deps.warshipCombatPlanner.retaliate(actor, tile, target, cause, hooks);
  }
  function planWarshipThreatPass(actor,run){
    const previous=warshipPatrolScopes.get(actor);
    warshipPatrolScopes.set(actor,{stopped:false});warshipThreatSources.set(actor,new Map());
    try{return run();}finally{if(previous===undefined)warshipPatrolScopes.delete(actor);else warshipPatrolScopes.set(actor,previous);warshipThreatSources.delete(actor);}
  }
  function warshipThreatAllowed(actor){return warshipCombatHooks(actor,deps.warshipThreatPlanner).allowed();}
  function selectWarshipThreat(actor,mode,input){
    const previous=warshipPatrolScopes.get(actor);
    if(!previous)warshipPatrolScopes.set(actor,{stopped:false});
    try{
      const hooks=warshipCombatHooks(actor,deps.warshipThreatPlanner);
      hooks.remember=(kind,tile,id)=>warshipThreatSources.get(actor)?.set(`${kind}:${tile}`,id);
      return deps.warshipThreatPlanner.select(actor,mode,input,hooks);
    }finally{if(!previous)warshipPatrolScopes.delete(actor);}
  }
  function planIncomingTransports(actor){return planShipResponses(actor,'incoming');}
  function planOutgoingShips(actor,mode){return planShipResponses(actor,mode);}
  function planWarshipTracking(actor){return planShipResponses(actor,'tracking');}
  function planShipResponses(actor,mode){
    const previous=warshipPatrolScopes.get(actor),scope={stopped:false};
    warshipPatrolScopes.set(actor,scope);
    try{
      const hooks=warshipCombatHooks(actor,deps.warshipTransportPlanner),choose=hooks.choose;
      hooks.choose=(domain,candidates,facts)=>choose(domain,candidates,facts,facts.parentDecisionId??activePlans.get(actor));
      hooks.spawnParent=()=>warshipSites.get(actor);
      hooks.clearSpawn=()=>warshipSites.delete(actor);
      if(mode==='incoming')return deps.warshipTransportPlanner.incoming(actor,hooks);
      if(mode==='tracking')return deps.warshipTransportPlanner.tracking(actor,hooks);
      return deps.warshipTransportPlanner.outgoing(actor,mode,hooks);
    }
    finally{if(previous===undefined)warshipPatrolScopes.delete(actor);else{if(scope.stopped)previous.stopped=true;warshipPatrolScopes.set(actor,previous);}}
  }
  function planWarshipDeployment(actor) {
    const hooks = warshipCombatHooks(actor, deps.warshipDeploymentPlanner);
    hooks.naval = () => teamNavalFacts(actor);
    if(tradeAreasEnabled(actor)){
      hooks.hotspotMode=true;
      hooks.reserve=()=>{
        const naval=hooks.naval();if(naval)return BigInt(naval.reserve);
        const defense=defenseEconomyFacts(actor),structure=owners.get(actor)?.bot.structureBehavior;
        return defense?defense.reserve+(defense.requiredType?BigInt(structure.cost(defense.requiredType)):0n):0n;
      };
      hooks.hasTradePost=ports=>deps.warshipTradeHotspots.deployment(actor,ports).length>0;
      hooks.replacement=()=>deps.warshipTradeHotspots.replacement?.(actor);
      hooks.waitingReplacement=()=>deps.warshipTradeHotspots.waitingReplacement?.(actor);
      hooks.deployed=area=>deps.warshipTradeHotspots.replacementSubmitted(actor,area);
      hooks.tradeSite=(ports,parentDecisionId,post=null)=>{
        const entries=deps.warshipTradeHotspots.deployment(actor,ports,post);
        if(!entries.length)return post?{tile:null}:null;
        const candidates=entries.map((entry,priority)=>({...entry,id:'trade-port:'+priority,kind:'warship-placement',priority,eligible:true}));
        const choice=hooks.choose('warship-placement',[...candidates,{id:'$wait',kind:'wait',reason:'Hold trade-area deployment'}],{purpose:post?'replace-piracy-post':'trade-area',postTile:post?.tile,postKey:post?.key},parentDecisionId);
        return {tile:candidates.find(c=>c.id===choice.selectedId)?.tile??null,decisionId:choice.decisionId};
      };
    }
    hooks.strategicSite = (ports, parentDecisionId, rejected = new Set()) => {
      const facts = hooks.naval(), game = actor.game;
      const entries = [];
      for (const port of ports) {
        if (port.isActive && !port.isActive() || port.isUnderConstruction?.()) continue;
        if (!facts.defensePortTiles.includes(port.tile())) continue;
        const samples = [...game.neighbors(port.tile())];
        for (const radius of [8,20,40]) for (let i=0;i<8;i++) {
          const x = Math.round(game.x(port.tile()) + Math.cos(i*Math.PI/4)*radius);
          const y = Math.round(game.y(port.tile()) + Math.sin(i*Math.PI/4)*radius);
          if (game.isValidCoord(x,y)) samples.push(game.ref(x,y));
        }
        for (const tile of samples) if (!rejected.has(tile) && game.isWater(tile) && facts.sharedComponents.includes(game.getWaterComponent(tile))) {
          if (!entries.some(e => e.tile === tile)) entries.push({ id:'island-site:'+entries.length,kind:'warship-placement',
            tile,portTile:port.tile(),eligible:true,priority:entries.length,reason:'Usable own port on water shared with the enemy coast' });
        }
      }
      if(tradeAreasEnabled(actor)){
        const traffic=deps.warshipTradeHotspots.deployment(actor,ports);
        for(const entry of entries)entry.tradeScore=traffic.find(t=>t.portTile===entry.portTile)?.score||0;
        entries.sort((a,b)=>b.tradeScore-a.tradeScore||a.priority-b.priority);
        entries.forEach((entry,index)=>entry.priority=index);
      }
      const choice = hooks.choose('warship-placement', [...entries.slice(0,79),{id:'$wait',kind:'wait',reason:'Hold island fleet placement'}],
        {island:true,ports:ports.length}, parentDecisionId);
      return {tile:entries.slice(0,79).find(e=>e.id===choice.selectedId)?.tile ?? null,decisionId:choice.decisionId};
    };
    hooks.spawn = (center, radius, parent) => hooks.execute(parent, () => {
      warshipSites.delete(actor);
      const tile = actor.warshipSpawnTile(center, radius);
      return { tile, decisionId: warshipSites.get(actor) ?? parent };
    });
    return deps.warshipDeploymentPlanner.deploy(actor, hooks);
  }
  function selectWarshipSpawn(actor, center, radius) {
    return deps.warshipDetailsPlanner.spawn(actor, center, radius, warshipCombatHooks(actor, deps.warshipDetailsPlanner));
  }
  function selectMovingWarship(actor, tile, context) {
    const hooks=warshipCombatHooks(actor,deps.warshipDetailsPlanner);
    if(tradeAreasEnabled(actor))hooks.canMove=ship=>!deps.warshipTradeHotspots.posted?.(actor,ship)&&!deps.warshipTradeHotspots.defending?.(actor,ship);
    return deps.warshipDetailsPlanner.move(actor,tile,context,hooks);
  }
  function planWarshipInfestation(actor, teamGame) {
    return deps.warshipDeploymentPlanner.counter(actor, teamGame, warshipCombatHooks(actor, deps.warshipDeploymentPlanner));
  }
  function selectWarshipInfestation(actor, teamGame) {
    return deps.warshipDeploymentPlanner.select(actor, teamGame, warshipCombatHooks(actor, deps.warshipDeploymentPlanner)).target;
  }
  function strikeAllowed(actor) {
    const controller = owners.get(actor);
    return Boolean(controller && deps.enabled() && deps.isCurrent(controller.bot) && !deps.isPublic(controller.bot.mg));
  }
  function planWarshipMaintenance(bot, tick) {
    const controller=owners.get(bot),actor=bot.warshipBehavior;
    if(!controller||!deps.warshipMaintenancePlanner)throw new Error('Warship maintenance planner is not attached');
    return deps.warshipMaintenancePlanner.run(bot,tick,{
      allowed:()=>deps.enabled()&&deps.isCurrent(controller.bot)&&!deps.isPublic(controller.bot.mg),
      choose:(candidates,facts)=>controller.engine.decide({
        ...safe(()=>snapshot(controller),{unavailable:true}),domain:'warship-maintenance',maintenance:facts
      },candidates),
      record:(kind,details)=>controller.engine.record(kind,details),
      execute:(decisionId,execute)=>{
        const previous=activePlans.get(actor);activePlans.set(actor,decisionId);
        try{return execute();}finally{
          if(previous===undefined)activePlans.delete(actor);else activePlans.set(actor,previous);
        }
      }
    });
  }
  function strikeHooks(actor, planner = deps.strikePlanner) {
    const controller = owners.get(actor);
    if (!controller || !planner) throw new Error('Strike planner is not attached');
    return {
      link: (result, decisionId) => { strikeProvenance.set(result,decisionId); return result; },
      parent: strikeDecisionId,
      allowed: () => strikeAllowed(actor),
      choose: (domain, candidates, facts) => controller.engine.decide({
        ...safe(() => snapshot(controller), { unavailable: true }), domain, strike: facts,
        ...(facts.parentDecisionId !== undefined || strikeRankScopes.has(actor) ? { parentDecisionId: facts.parentDecisionId ?? strikeRankScopes.get(actor)?.parentDecisionId } : {})
      }, candidates),
      record: (kind, details) => controller.engine.record(kind, details),
      lookup: (parentDecisionId, read) => {
        const previous = strikeRankScopes.get(actor), scope = { parentDecisionId, stopped: false };
        strikeRankScopes.set(actor,scope);
        try { return { target: read(), stopped: scope.stopped, decisionId: scope.decisionId }; }
        finally { if (previous === undefined) strikeRankScopes.delete(actor); else strikeRankScopes.set(actor,previous); }
      }
    };
  }
  function selectStrikePlayer(actor, mode) {
    const hooks = strikeHooks(actor, deps.strikeRanking);
    const result = deps.strikeRanking.select(actor, mode, hooks);
    const scope = strikeRankScopes.get(actor);
    if (result.target && scope) scope.decisionId = result.decisionId;
    if (result.stop && scope) scope.stopped = true;
    return result.target;
  }
  function planMirv(actor, cost) { return deps.strikePlanner.mirv(actor, cost, strikeHooks(actor)); }
  function selectNukeWeapon(actor, context, selection) {
    if (selection) delete selection.decisionId;
    const hooks=strikeHooks(actor);
    hooks.selected=decisionId=>{if(selection)selection.decisionId=decisionId;};
    return deps.strikePlanner.weapon(actor, context, hooks);
  }
  function planNuke(actor, sites, context) { return deps.strikePlanner.nuke(actor, sites, context, strikeHooks(actor)); }
  function selectNukeTarget(actor, selection) {
    if(selection)delete selection.decisionId;
    const hooks = strikeHooks(actor, deps.strikeTargetPlanner);
    hooks.selected=decisionId=>{if(selection)selection.decisionId=decisionId;};
    hooks.incoming = decisionId => {
      const attacker = actor.attackBehavior;
      const previousScope = attackScopes.get(attacker), previousParent = activePlans.get(attacker);
      const scope = { stopped: false };
      attackScopes.set(attacker, scope); activePlans.set(attacker, decisionId);
      try { return { target: attacker.findIncomingAttackPlayer(), stopped: scope.stopped, decisionId: scope.decisionId }; }
      finally {
        if (previousScope === undefined) attackScopes.delete(attacker); else attackScopes.set(attacker, previousScope);
        if (previousParent === undefined) activePlans.delete(attacker); else activePlans.set(attacker, previousParent);
      }
    };
    return deps.strikeTargetPlanner.target(actor, hooks);
  }
  function planSamClear(actor, target, sams, context) {
    return deps.strikeTargetPlanner.sam(actor, target, sams, context, strikeHooks(actor, deps.strikeTargetPlanner));
  }
  function planHelpfulSilo(actor, context) {
    return deps.strikeTargetPlanner.upgrade(actor, context, strikeHooks(actor, deps.strikeTargetPlanner));
  }
  function selectNukeArc(actor, context) {
    return deps.strikeTargetPlanner.arc(actor, context, strikeHooks(actor, deps.strikeTargetPlanner));
  }
  function planSaturationSalvo(actor, context) {
    return deps.strikeTargetPlanner.salvo(actor, context, strikeHooks(actor, deps.strikeTargetPlanner));
  }
  function strikeDecisionId(result) { return strikeProvenance.get(result); }
  function strikeBuild(actor, decisionId, source, menu, ...args) {
    const previous = activePlans.get(actor);
    if (decisionId !== undefined) activePlans.set(actor, decisionId);
    try { return build(actor, source, menu, ...args); }
    finally {
      if (previous === undefined) activePlans.delete(actor);
      else activePlans.set(actor, previous);
    }
  }
  function planWarshipPatrol(actor, sites, context) {
    if(warshipPatrolScopes.get(actor)?.stopped)return;
    if(tradeAreasEnabled(actor))sites=sites.filter(site=>site.kind!=='trade-lane');
    sites=sites.map(site=>({...site,sourceDecisionId:warshipThreatSources.get(actor)?.get(`${({'loss-zone':'loss','trade-lane':'trade'}[site.kind]||site.kind)}:${site.tile}`)}));
    const controller = owners.get(actor);
    if (!controller || !deps.warshipPatrolPlanner) throw new Error('Warship patrol planner is not attached');
    const naval = teamNavalFacts(actor);
    if (deps.teamGeography) sites = [...sites, ...deps.teamGeography.coastalPatrols(actor.game, actor.player, naval).map(s=>({...s,adaptiveOnly:true}))];
    const previousScope = warshipPatrolScopes.get(actor);
    const scope = { stopped: false };
    warshipPatrolScopes.set(actor, scope);
    try { return deps.warshipPatrolPlanner.run(actor, sites, context, {
      allowed: () => !scope.stopped && deps.enabled() && deps.isCurrent(controller.bot) && !deps.isPublic(controller.bot.mg),
      choose: candidates => controller.engine.decide({
        ...safe(() => snapshot(controller), { unavailable: true }), domain: 'warship-patrol',
        teamNaval: naval,
        patrol: { tick: context.tick, cellSize: context.cellSize, serviceTicks: context.serviceTicks },
        ...(activePlans.has(actor) ? { parentDecisionId: activePlans.get(actor) } : {})
      }, candidates),
      record: (kind, details) => controller.engine.record(kind, details),
      execute: (decisionId, execute) => {
        const previous = activePlans.get(actor);
        activePlans.set(actor, decisionId);
        try { return execute(); }
        finally {
          if (previous === undefined) activePlans.delete(actor);
          else activePlans.set(actor, previous);
        }
      }
    }); } finally {
      if (previousScope === undefined) warshipPatrolScopes.delete(actor);
      else warshipPatrolScopes.set(actor, previousScope);
    }
  }
  async function planStructures(actor, context) {
    const controller = owners.get(actor);
    if (!controller || !deps.structurePlanner) throw new Error('Structure planner is not attached');
    context = { ...context, teamOpening: openingFacts(actor, context) };
    context.defenseEconomy=defenseEconomyFacts(actor);
    if(context.defenseEconomy){const gold=actor.player.gold();context.defenseEconomy={...context.defenseEconomy,
      availableGold:gold-(controller.spending?.facts({tick:actor.game.ticks(),gold,cost:0n,key:'plan'}).pendingCost||0n)};}
    const allowed = () => buildingAllowed(actor);
    return deps.structurePlanner.run(actor, context, {
      allowed,
      choose: candidates => {
        const choice = controller.engine.decide({
        ...safe(() => snapshot(controller), { unavailable: true }),
        domain: 'structure-plan', structure: context, teamOpening: context.teamOpening, teamNaval: teamNavalFacts(actor),
        defenseEconomy:context.defenseEconomy,
        ...(activePlans.has(actor) ? { parentDecisionId: activePlans.get(actor) } : {})
        }, candidates);
        if (buildingScopes.has(actor) && !candidates.some(candidate => candidate.id === choice.selectedId && candidate.kind === 'structure-plan' && candidate.eligible)) buildingScopes.get(actor).stopped = true;
        return choice;
      },
      record: (kind, details) => controller.engine.record(kind, details),
      execute: async (plan, decisionId, execute) => {
        const previous = openingStructurePlans.get(actor);
        openingStructurePlans.set(actor, plan);
        try { return await withPlan(actor, decisionId, execute); }
        finally {
          if (previous === undefined) openingStructurePlans.delete(actor);
          else openingStructurePlans.set(actor, previous);
        }
      }
    });
  }
  function buildingAllowed(actor) {
    const controller = owners.get(actor);
    return !!controller && deps.enabled() && deps.isCurrent(controller.bot) &&
      !deps.isPublic(controller.bot.mg) && !buildingScopes.get(actor)?.stopped;
  }
  async function planBuilding(actor, mode, first, second) {
    const controller = owners.get(actor);
    if (!controller || !deps.buildingPlanner) throw new Error('Building planner is not attached');
    if (!['handle', 'action', 'upgrade', 'defense'].includes(mode)) throw new Error('Unknown building planner mode: ' + mode);
    const existing = buildingScopes.get(actor);
    const scope = existing || { stopped: false };
    if (!existing) buildingScopes.set(actor, scope);
    const hooks = {
      forceNew: openingStructurePlans.get(actor)?.forceNew === true,
      allowed: () => buildingAllowed(actor),
      choose: (domain, candidates, facts) => {
        const choice = controller.engine.decide({
          ...safe(() => snapshot(controller), { unavailable: true }), domain, building: facts,
          teamOpening: openingFacts(actor),defenseEconomy:defenseEconomyFacts(actor),
          ...(activePlans.has(actor) ? { parentDecisionId: activePlans.get(actor) } : {})
        }, candidates);
        if (!candidates.some(candidate => candidate.id === choice.selectedId && candidate.kind === domain && candidate.eligible)) {
          scope.stopped = true;
          controller.engine.record('building-result', { domain, decisionId: choice.decisionId,
            status: 'stopped', reason: choice.reason });
        }
        return choice;
      },
      execute: (decisionId, execute) => withPlan(actor, decisionId, execute),
      record: (kind, details) => controller.engine.record(kind, details),
      remember: (quote, decisionId) => {
        if (quote && typeof quote === 'object') placementParents.set(quote, decisionId);
      }
    };
    try {
      if (mode === 'handle') {
        if(await maybeReactiveSam(actor))return true;
        if(!buildingAllowed(actor))return false;
        return await deps.buildingPlanner.handle(actor, hooks);
      }
      if (mode === 'action') return await deps.buildingPlanner.action(actor, first, second, hooks);
      return await deps.buildingPlanner[mode](actor, first, hooks, second);
    } finally {
      if (!existing) buildingScopes.delete(actor);
    }
  }
  async function planStructurePlacement(actor, unitType) {
    const controller = owners.get(actor);
    if (!controller || !deps.structurePlacementPlanner) throw new Error('Structure placement planner is not attached');
    return deps.structurePlacementPlanner.run(actor, unitType, {
      allowed: () => buildingAllowed(actor),
      execute: (decisionId,execute) => withPlan(actor,decisionId,execute),
      choose: (candidates, facts) => {
        const choice = controller.engine.decide({
        ...safe(() => snapshot(controller), { unavailable: true }), domain: 'structure-placement',
        structurePlacement: facts,
        ...(activePlans.has(actor) ? { parentDecisionId: activePlans.get(actor) } : {})
        }, candidates);
        if (buildingScopes.has(actor) && !candidates.some(candidate => candidate.id === choice.selectedId && candidate.kind === 'structure-placement' && candidate.eligible)) buildingScopes.get(actor).stopped = true;
        return choice;
      },
      record: (kind, details) => controller.engine.record(kind, details),
      remember: (buildable, decisionId) => {
        if (buildable && typeof buildable === 'object') placementParents.set(buildable, decisionId);
      }
    });
  }
  function inspect() {
    if (!current) return { schemaVersion: 1, strategy: 'legacy-v1', records: [], droppedRecords: 0 };
    return { ...current.engine.exportTrace(), coverage: { rules: [...current.observedRules],
      unavailableRuleHooks: [...current.missingRules] } };
  }
  async function planBotTargets(actor) {
    const controller = owners.get(actor);
    if (!controller || !deps.botTargetPlanner) throw new Error('Bot-target planner is not attached');
    const previousScope=attackScopes.get(actor);
    if(!previousScope)attackScopes.set(actor,{stopped:false});
    try { return await deps.botTargetPlanner.run(actor, {
      allowed: () => deps.enabled() && deps.isCurrent(controller.bot) && !deps.isPublic(controller.bot.mg) && !attackScopes.get(actor)?.stopped,
      choose: (candidates, context) => {
        const choice = controller.engine.decide({
        ...safe(() => snapshot(controller), { unavailable: true }), domain: 'bot-target', botTargets: context,
        ...(activePlans.has(actor) ? { parentDecisionId: activePlans.get(actor) } : {})
        }, candidates);
        if (attackScopes.has(actor) && (choice.selectedId === null || candidates.some(c => c.kind === 'bot-target' && c.eligible)) &&
          !candidates.some(c => c.id === choice.selectedId && c.kind === 'bot-target' && c.eligible)) attackScopes.get(actor).stopped = true;
        return choice;
      },
      record: (kind, details) => controller.engine.record(kind, details),
      execute: (plan, decisionId, execute) => withPlan(actor, decisionId, execute)
    }); } finally { if(!previousScope)attackScopes.delete(actor); }
  }
  function attackHooks(actor) {
    const controller = owners.get(actor);
    if (!controller || !deps.attackPlanner) throw new Error('Attack planner is not attached');
    return {
      allowed: () => deps.enabled() && deps.isCurrent(controller.bot) && !deps.isPublic(controller.bot.mg) && !attackScopes.get(actor)?.stopped,
      choose: (domain, candidates, context) => {
        const choice = controller.engine.decide({
        ...safe(() => snapshot(controller), { unavailable: true }), domain, attack: context,
        ...(activePlans.has(actor) ? { parentDecisionId: activePlans.get(actor) } : {})
        }, candidates);
        if (domain === 'attack-plan' && attackScopes.has(actor) && !candidates.some(c => c.id === choice.selectedId && c.kind === domain && c.eligible)) attackScopes.get(actor).stopped = true;
        return choice;
      },
      record: (kind, details) => controller.engine.record(kind, details),
      execute: (decisionId, execute) => withPlan(actor, decisionId, execute),
      geography: mode => chooseAttackGeography(actor, mode)
    };
  }
  function attackGeographyHooks(actor) {
    const controller = owners.get(actor);
    if (!controller || !deps.attackGeographyPlanner) throw new Error('Attack-geography planner is not attached');
    return {
      allowed: () => deps.enabled() && deps.isCurrent(controller.bot) && !deps.isPublic(controller.bot.mg) &&
        !attackScopes.get(actor)?.stopped,
      choose: (domain, candidates, facts) => controller.engine.decide({
        ...safe(() => snapshot(controller), { unavailable: true }), domain, attackGeography: facts,
        ...(activePlans.has(actor) ? { parentDecisionId: activePlans.get(actor) } : {})
      }, candidates),
      probe: tile => deps.probeLanding(actor, tile, false),
      record: (kind, details) => controller.engine.record(kind, details)
    };
  }
  function boatHooks(actor) {
    const controller=owners.get(actor);
    if(!controller||!deps.boatPlanner)throw new Error('Boat planner is not attached');
    let stopped=false;
    const allowed=()=>!stopped && deps.enabled() && deps.isCurrent(controller.bot) &&
      !deps.isPublic(controller.bot.mg) && !attackScopes.get(actor)?.stopped && !navalScopes.get(actor)?.stopped;
    const executeSync=(decisionId,run)=>{
      const previous=activePlans.get(actor);activePlans.set(actor,decisionId);
      try{return run();}finally{if(previous===undefined)activePlans.delete(actor);else activePlans.set(actor,previous);}
    };
    const dispatch=(id,run)=>{
      if(!allowed())return false;
      declined.delete(actor);
      transportHeld.delete(actor);
      try {
        const sent=executeSync(id,run);
        if(declined.get(actor)===true&&!transportHeld.has(actor)){
          stopped=true;
          if(navalScopes.has(actor))navalScopes.get(actor).stopped=true;
          if(attackScopes.has(actor))attackScopes.get(actor).stopped=true;
        }
        return sent;
      } catch(error){
        controller.engine.record('boat-detail-result',{domain:'boat-allocation',decisionId:id,status:'threw'});
        throw error;
      }
    };
    return {
      allowed,
      choose:(domain,candidates,facts)=>{
        let parent=activePlans.get(actor);
        const origin=boatOrigins.get(actor),destination=boatDestinations.get(actor);
        if(domain==='boat-allocation'&&destination?.tile===facts.tile)parent=destination.decisionId;
        else if((domain==='boat-search'||domain==='boat-destination'&&facts.mode==='random')&&origin&&parent===origin.parentId)parent=origin.decisionId;
        const choice=controller.engine.decide({...safe(()=>snapshot(controller),{unavailable:true}),domain,boat:facts,
          ...(parent!==undefined?{parentDecisionId:parent}:{})},candidates);
        if(!candidates.some(c=>c.id===choice.selectedId&&c.kind===domain&&c.eligible)) {
          stopped=true;
          if(navalScopes.has(actor))navalScopes.get(actor).stopped=true;
          if(attackScopes.has(actor))attackScopes.get(actor).stopped=true;
        }
        return choice;
      },
      execute:(id,run)=>withPlan(actor,id,run),
      probe:(id,tile)=>withPlan(actor,id,()=>deps.probeLanding(actor,tile,false)),
      remember:(tile,id,kind)=>{
        if(kind==='origin'){boatOrigins.set(actor,{tile,decisionId:id,parentId:activePlans.get(actor)});boatDestinations.delete(actor);}
        else boatDestinations.set(actor,{tile,decisionId:id});
      },
      record:(kind,details)=>controller.engine.record(kind,details),
      launch:(id,tile,troops)=>{
        boatDestinations.delete(actor);boatOrigins.delete(actor);
        return dispatch(id,()=>actor._launchTacticalBoat(tile,troops));
      },
      emit:(id,tile,troops,label)=>{
        boatDestinations.delete(actor);boatOrigins.delete(actor);
        return dispatch(id,()=>actor.emitBoat(tile,troops,label));
      }
    };
  }
  function chooseBoatOrigin(actor,shore){return deps.boatPlanner.origin(actor,shore,boatHooks(actor));}
  function chooseBoatCrater(actor,hits){return deps.boatPlanner.crater(actor,hits,boatHooks(actor));}
  async function planBoatSites(actor,sites,context){
    const inputs=sites.map(site=>({...site,ownerId:site.owner?.isPlayer()?site.owner.id():site.ownerId??null}));
    return deps.boatPlanner.destination(actor,inputs,context,boatHooks(actor));
  }
  function launchBoat(actor,tile,mode,label){
    const hooks=boatHooks(actor),choice=deps.boatPlanner.allocation(actor,{tile,mode},hooks);
    if(!choice)return false;
    const sent=hooks.emit(choice.decisionId,tile,choice.troops,label);
    hooks.record('boat-detail-result',{domain:'boat-allocation',decisionId:choice.decisionId,status:'launch-result',tile,troops:choice.troops,submitted:!!sent});
    return sent;
  }
  function reconcileRiverLandings(actor){
    const controller=owners.get(actor),state=controller?.riverState;
    if(!state)return;
    const tick=actor.game.ticks();
    if(tick<state.lastTick){controller.riverState=null;return;}
    state.lastTick=tick;
    for(const [tile,at]of state.pending){
      if(actor.game.hasOwner(tile)&&actor.game.ownerID(tile)===actor.player.smallID()){
        state.pending.delete(tile);deps.openingExpansion?.resumeAfterCrossing?.(actor);
        controller.engine.record('wilderness-crossing-result',{tick,status:'landed',tile,reason:'Resume land expansion from the confirmed owned river landing'});
      }else if(tick-at>=200)state.pending.delete(tile);
    }
  }
  async function planWildernessCrossing(actor){
    const controller=owners.get(actor);
    if(!controller||!deps.wildernessCrossing||controller.engine.selectedStrategy?.()!=='adaptive-v1'||
        !deps.enabled()||!deps.isCurrent(controller.bot)||deps.isPublic(controller.bot.mg))return false;
    reconcileRiverLandings(actor);
    const game=actor.game,opening=openingFacts(actor),posture=supportPosture(actor);
    if(!opening?.borderKnown||posture?.conserve||opening.frontline&&!posture||
        deps.settings().features?.boat===false||game.config().isUnitDisabled(deps.transportType)||
        Math.floor(actor.player.troops()*.01)<1)return false;
    const tick=game.ticks(),state=controller.riverState??={lastTick:tick,lastAttempt:-Infinity,pending:new Map(),rejected:new Map(),inFlight:false};
    if(state.inFlight||tick-state.lastAttempt<10)return false;
    state.lastAttempt=tick;
    const capacity=transportCapacity(controller);if(!capacity.available)return false;
    for(const [tile,until]of state.rejected)if(until<=tick)state.rejected.delete(tile);
    const taken=[...capacity.destinations,...capacity.state.pending.map(p=>p.tile),...state.pending.keys()];
    actor._inflightBoatTargets=capacity.destinations.map(tile=>({x:game.x?.(tile),y:game.y?.(tile)}));
    const free=tile=>game.isLand(tile)&&!game.hasOwner(tile)&&!game.hasFallout(tile);
    const sites=deps.wildernessCrossing.sites(actor).filter(site=>free(site.tile)&&!state.rejected.has(site.tile)&&
      !taken.some(tile=>game.manhattanDist(tile,site.tile)<=24));
    if(!sites.length)return false;
    state.inFlight=true;const previous=navalScopes.get(actor);
    if(!previous)navalScopes.set(actor,{stopped:false});
    try{
      const tile=await planNavalLanding(actor,sites,{mode:'river',probeCap:2});
      if(tile===null||!free(tile)||!deps.enabled()||!deps.isCurrent(controller.bot)||supportPosture(actor)?.conserve)return false;
      if(deps.settings().features?.boat===false||game.config().isUnitDisabled(deps.transportType)||
          Math.floor(actor.player.troops()*.01)<1||!transportCapacity(controller).available)return false;
      const site=sites.find(s=>s.tile===tile);
      if(!site||!game.hasOwner(site.origin)||game.ownerID(site.origin)!==actor.player.smallID())return false;
      const sent=launchBoat(actor,tile,'river-1pct','🌊 Cross river into wilderness (1%)');
      if(sent)state.pending.set(tile,game.ticks());
      controller.engine.record('wilderness-crossing-result',{tick:game.ticks(),status:sent?'submitted':'held',tile,
        crossingSteps:site.crossingSteps,room:site.room,reason:'Short neutral crossing alongside land expansion'});
      return !!sent;
    }finally{state.inFlight=false;if(!previous)navalScopes.delete(actor);}
  }
  async function planTacticalBoat(actor,shore,enemies){
    const previous=navalScopes.get(actor);
    if(!previous)navalScopes.set(actor,{stopped:false});
    boatOrigins.delete(actor);boatDestinations.delete(actor);
    try{return await deps.boatPlanner.tactical(actor,shore,enemies,boatHooks(actor));}
    finally{if(!previous)navalScopes.delete(actor);}
  }
  function planNavalLanding(actor, sites, context) {
    const controller = owners.get(actor);
    if (!controller || !deps.navalLandingPlanner) throw new Error('Naval landing planner is not attached');
    return deps.navalLandingPlanner.run(actor, sites, context, {
      allowed: () => deps.enabled() && deps.isCurrent(controller.bot) && !deps.isPublic(controller.bot.mg) && !attackScopes.get(actor)?.stopped && !navalScopes.get(actor)?.stopped,
      stop: choice => {
        const scope = navalScopes.get(actor);
        if (scope) {
          scope.stopped = true;
          controller.engine.record('naval-stop', { decisionId: choice.decisionId, reason: 'Landing policy stopped the enclosing naval pass' });
        }
      },
      choose: (candidates, facts) => controller.engine.decide({
        ...safe(() => snapshot(controller), { unavailable: true }), domain: 'naval-landing', navalLanding: facts,
        ...(activePlans.has(actor) ? { parentDecisionId: activePlans.get(actor) } : {})
      }, candidates),
      probe: async (decisionId, tile, fallback) => {
        const probe=context.mode==='river'&&deps.probeCrossing?deps.probeCrossing:deps.probeLanding;
        let result=await withPlan(actor,decisionId,()=>probe(actor,tile,fallback));
        if(context.mode==='river'&&(!Number.isFinite(result)||actor.game.manhattanDist(result,tile)>24))result=false;
        if(context.mode==='river'&&result===false)controller.riverState?.rejected.set(tile,actor.game.ticks()+30);
        if(result!==false&&result!==fallback)boatDestinations.set(actor,{tile,decisionId});
        return result;
      },
      record: (kind, details) => controller.engine.record(kind, details),
      diagnostics: data => deps.landingDiagnostics(data)
    });
  }
  async function planNavalActions(actor, context) {
    const controller = owners.get(actor);
    if (!controller || !deps.navalActionPlanner) throw new Error('Naval action planner is not attached');
    const posture=supportPosture(actor);
    if(posture?.conserve){controller.engine.record('naval-action-result',{status:'held',reason:posture.reason});return false;}
    if(await planWildernessCrossing(actor))return true;
    const previous = navalScopes.get(actor);
    navalScopes.set(actor, { stopped: false });
    boatOrigins.delete(actor);boatDestinations.delete(actor);
    try {
      return await deps.navalActionPlanner.run(actor, context, {
        allowed: () => deps.enabled() && deps.isCurrent(controller.bot) && !deps.isPublic(controller.bot.mg) && !attackScopes.get(actor)?.stopped && !navalScopes.get(actor)?.stopped,
        choose: (candidates, facts) => {
          const choice = controller.engine.decide({
          ...safe(() => snapshot(controller), { unavailable: true }), domain: 'naval-action', navalAction: facts,
          teamOpening:openingFacts(actor),supportPosture:supportPosture(actor),
          ...(activePlans.has(actor) ? { parentDecisionId: activePlans.get(actor) } : {})
          }, candidates);
          if (attackScopes.has(actor) && !candidates.some(c => c.id === choice.selectedId && c.kind === 'naval-action' && c.eligible)) attackScopes.get(actor).stopped = true;
          return choice;
        },
        execute: (decisionId, execute) => withPlan(actor, decisionId, execute),
        probe: tile => deps.probeLanding(actor, tile, false),
        origin: shore=>chooseBoatOrigin(actor,shore),
        nearby: (sites,cap)=>planBoatSites(actor,sites,{mode:'nearby',cap}),
        launch: (tile,mode,label)=>launchBoat(actor,tile,mode,label),
        record: (kind, details) => controller.engine.record(kind, details)
      });
    } finally {
      if (navalScopes.get(actor)?.stopped && attackScopes.has(actor)) attackScopes.get(actor).stopped = true;
      if (previous === undefined) navalScopes.delete(actor);
      else navalScopes.set(actor, previous);
    }
  }
  async function findEnemyProbeTarget(actor){
    const controller=owners.get(actor);
    if(!controller||!deps.boatPlanner)throw new Error('Enemy probe planner is not attached');
    const sites=deps.boatPlanner.enemyProbeSites(actor);
    controller.engine.record('transport-target-search',{tick:actor.game.ticks(),mode:'enemy-probe',
      candidates:sites.length,reason:sites.length?'Hostile shore on reachable water':'No hostile shore shares owned water'});
    return planNavalLanding(actor,sites,{mode:'distant',probeCap:deps.settings().distantBoatProbeMax||12});
  }
  function openingFacts(actor, context) {
    if (!deps.twoTeamOpening) return null;
    if (context?.sharedWater === undefined && actor._sharedWaterComponents !== undefined) {
      context = {...context,sharedWater:actor._sharedWaterComponents !== null};
    }
    return deps.twoTeamOpening.observe(actor.game, actor.player, context);
  }
  function supportPosture(actor){
    const controller=owners.get(actor);
    if(!controller?.supportObserver||controller.engine.selectedStrategy?.()!=='adaptive-v1')return null;
    const game=actor.game||actor.mg||controller.bot.mg,player=actor.player||controller.bot.player;
    let facts=controller.supportObserver.observe(game,player,openingFacts({game,player}));
    if(facts){
      const expanding=deps.settings().features?.expand!==false;
      if(!expanding)facts={...facts,donationReady:true,donationHoldReason:undefined};
      const river=controller.riverState,pending=river?.inFlight||[...(river?.pending||[])].some(([tile,at])=>
        game.ticks()-at<200&&(!game.hasOwner(tile)||game.ownerID(tile)!==player.smallID()));
      if(expanding&&pending)facts={...facts,donationReady:false,donationHoldReason:'Wait for the river landing and continue expansion before donating'};
      const key=[facts.ready,facts.conserve,facts.donationReady,facts.donationHoldReason,facts.reason,facts.anchor].join('|');
      if(key!==controller.lastSupportKey){controller.lastSupportKey=key;controller.engine.record('support-posture',{tick:game.ticks(),...facts});}}
    return facts;
  }
  function probeThrottle(actor,fallback){const p=supportPosture(actor);return p?.ready&&!p.conserve?Math.min(fallback,p.probeThrottleMs??fallback):fallback;}
  function defenseEconomyFacts(actor){
    const controller=owners.get(actor);
    if(!deps.defenseEconomy||controller?.engine.selectedStrategy?.()!=='adaptive-v1')return null;
    const game=actor.game||actor.mg||controller.bot.mg,player=actor.player||controller.bot.player;
    const structure=controller.bot.structureBehavior;
    const facts=deps.defenseEconomy.observe(game,player,openingFacts({game,player,_sharedWaterComponents:structure?._sharedWaterComponents}));
    if(!facts||!controller.samDevelopment||!deps.samDefenseObserver)return facts;
    const observation=deps.samDefenseObserver.observe(game,player);
    const planned=samDevelopmentFacts(actor,observation,facts);
    return {...facts,emergencyReserve:facts.reserve,plannedSamSavings:planned.savings,reserve:facts.reserve+planned.savings};
  }
  function samDevelopmentFacts(actor,observation,economy){
    const controller=owners.get(actor);
    if(!controller?.samDevelopment)return {candidates:[],savings:0n,blocked:[]};
    const game=actor.game||actor.mg||controller.bot.mg;
    return controller.samDevelopment.assess(observation,{economy,
      range:level=>game.config().samRange(level),distanceSquared:(a,b)=>game.euclideanDistSquared(a,b)});
  }
  async function maybeReactiveSam(actor){
    const controller=owners.get(actor);
    if(!deps.samDefenseObserver||!deps.createReactiveSam||!deps.sendSamUpgrade||reactiveInFlight.has(actor)||
        controller?.engine.selectedStrategy?.()!=='adaptive-v1'||!buildingAllowed(actor))return false;
    const game=actor.game,player=actor.player,config=game.config();
    if(config.isUnitDisabled(deps.units.SAMLauncher)||deps.buildAllowed?.(deps.units.SAMLauncher)===false)return false;
    const predictor=()=>deps.createReactiveSam({range:level=>config.samRange(level),
      distance:(a,b)=>game.manhattanDist(a,b),distanceSquared:(a,b)=>game.euclideanDistSquared(a,b),
      cooldown:typeof config.SAMCooldown==='function'?config.SAMCooldown():90,
      upgradeDuration:typeof config.samUpgradeDuration==='function'?config.samUpgradeDuration():45});
    let observation=deps.samDefenseObserver.observe(game,player);
    if(observation.reason)return false;
    let economy=defenseEconomyFacts(actor),planned=samDevelopmentFacts(actor,observation,economy);
    if(!observation.threats.some(t=>t.threatensSelf||t.threatensSamArea)&&!planned.savings)return false;
    const previews=predictor().assess({...observation,candidates:observation.ownSams.map(s=>({unitId:s.id(),cost:0n}))});
    const quotes=new Map();reactiveInFlight.add(actor);
    try{
      const useful=new Set([...previews.filter(p=>p.canDefend),...planned.candidates].map(p=>p.unitId));
      for(const unitId of useful){
        const unit=observation.ownSams.find(s=>s.id()===unitId);
        if(!unit)continue;
        const quote=await actor.buildableFor(deps.units.SAMLauncher,unit.tile());
        if(!buildingAllowed(actor))return false;
        if(quote&&quote.canUpgrade===unit.id())quotes.set(unit.id(),quote);
      }
      observation=deps.samDefenseObserver.observe(game,player);
      economy=defenseEconomyFacts(actor);planned=samDevelopmentFacts(actor,observation,economy);
      const assessments=observation.reason?[]:predictor().assess({...observation,candidates:[...quotes].map(([unitId,q])=>({unitId,
        cost:q.upgradeCosts?.[0]??q.cost}))});
      const cs=assessments.map((p,i)=>{
        const preparation=planned.candidates.find(c=>c.unitId===p.unitId);
        const mode=p.canDefend?'emergency':'planned',protectedReserve=mode==='planned'?(economy?.emergencyReserve??economy?.reserve??3000000n):0n;
        const useful=!!(p.canDefend||preparation);
        const spending=useful?controller.spending.facts({tick:game.ticks(),gold:player.gold(),cost:p.cost,
          reserve:protectedReserve,key:`${deps.units.SAMLauncher}:upgrade:${p.unitId}`}):{allowed:false,reason:p.reason};
        return {...p,...(!p.canDefend&&preparation?preparation:{}),mode,protectedReserve,
          priority:mode==='emergency'?0:1,interceptionKind:p.kind,id:`reactive-sam:${i}`,kind:'reactive-sam-upgrade',
          spending,eligible:useful&&spending.allowed};
      });
      const choice=controller.engine.decide({...snapshot(controller),domain:'reactive-sam-upgrade',
        defenseEconomy:defenseEconomyFacts(actor),samPreparation:planned,
        assessment:previews.map(({targetIds,unitId,reason,canDefend})=>({targetIds,unitId,reason,canDefend}))},
        [...cs,{id:'$wait',kind:'wait',eligible:true,reason:'Keep emergency funds; no proven useful upgrade'}]);
      const selected=cs.find(c=>c.id===choice.selectedId&&c.eligible);
      controller.engine.record('reactive-sam-result',{tick:game.ticks(),decisionId:choice.decisionId,
        status:selected?'selected':'held',reason:choice.reason,assessments:cs.length?cs:[...previews,...planned.candidates,...planned.blocked]});
      if(!selected){if(cs.some(c=>c.eligible)&&choice.selectedId==='$wait'&&buildingScopes.has(actor))buildingScopes.get(actor).stopped=true;return false;}
      if(!buildingAllowed(actor))return false;
      const quote=quotes.get(selected.unitId);reactiveQuotes.set(quote,{tick:game.ticks(),...selected});
      try{return withPlan(actor,choice.decisionId,()=>deps.sendSamUpgrade(actor,quote));}
      finally{reactiveQuotes.delete(quote);}
    }finally{reactiveInFlight.delete(actor);}
  }
  function teamNavalFacts(actor) {
    if (!deps.teamGeography || !actor?.player) return null;
    const game = actor.game || actor.mg;
    const naval = deps.teamGeography.navalFacts(game, actor.player);
    if (!naval) return null;
    const controller = owners.get(actor), structure = controller?.bot.structureBehavior;
    if (!structure || !deps.units) throw new Error('Two-team naval economy requires the structure planner');
    const U = deps.units, opening = openingFacts({game,player:actor.player,_sharedWaterComponents:structure._sharedWaterComponents});
    const available = type => !game.config().isUnitDisabled(type) && (!deps.buildAllowed || deps.buildAllowed(type));
    const development = [U.City,U.Port,U.Factory].find(available);
    const type = opening && opening.ports < Math.min(1,opening.portTarget) ? U.Port :
      opening && opening.cities < opening.cityTarget ? U.City :
      opening && opening.ports < opening.portTarget ? U.Port :
      opening && opening.factories < opening.factoryTarget ? U.Factory :
      opening?.samEnabled && !opening.sams ? U.SAMLauncher : development;
    let reserve = 0n;
    if (type !== undefined && available(type)) reserve = BigInt(structure.getPerceivedCost(type));
    reserve += BigInt(deps.reserveGold ? deps.reserveGold(actor.player.gold()) : 0n);
    const defense=defenseEconomyFacts(actor);
    if(defense)reserve=defense.reserve+(defense.requiredType?BigInt(structure.cost(defense.requiredType)):0n);
    const settings = deps.settings();
    const enabled = settings.features?.warship !== false && settings.warshipAutoSpawn !== false && !game.config().isUnitDisabled(U.Warship);
    return {...naval,reserve,fleetNeeded:naval.fleetNeeded && enabled};
  }
  function twoTeamOpeningVeto(actor, target) {
    const controller = owners.get(actor);
    if (!controller || !deps.twoTeamOpening || !target.isPlayer()) return undefined;
    const teamOpening = openingFacts(actor);
    if (!teamOpening) return undefined;
    const candidates = ['legacy', 'allow', 'defer'].map((mode, priority) => ({
      id: 'team-attack:' + mode, kind: 'team-opening-attack', eligible: true, priority,
      reason: mode === 'legacy' ? 'Use existing opening rules' : mode === 'allow' ?
        'Reachable wilderness cleared' : 'Finish reachable wilderness first' }));
    candidates.push({ id: '$wait', kind: 'wait', eligible: true, reason: 'Hold country expansion' });
    const choice = controller.engine.decide({ ...snapshot(controller), domain: 'team-opening-attack', teamOpening,
      ...(activePlans.has(actor) ? { parentDecisionId: activePlans.get(actor) } : {}) }, candidates);
    if (choice.selectedId === 'team-attack:legacy') return undefined;
    if (choice.selectedId === 'team-attack:allow') return false;
    if (choice.selectedId !== 'team-attack:defer' && attackScopes.has(actor)) attackScopes.get(actor).stopped = true;
    return true;
  }
  function twoTeamOpeningTileVeto(actor, tile) {
    if (!deps.twoTeamOpening || !owners.has(actor) || !actor.game.hasOwner(tile)) return undefined;
    const target = actor.game.playerBySmallID(actor.game.ownerID(tile));
    if (!target || target.smallID() === actor.player.smallID()) return undefined;
    return twoTeamOpeningVeto(actor, target);
  }
  async function planAttackSequence(actor, context) {
    const controller = owners.get(actor);
    if (!controller || !deps.attackSequencePlanner) throw new Error('Attack sequence planner is not attached');
    reconcileRiverLandings(actor);
    context = { ...context, teamOpening: openingFacts(actor) };
    deps.openingExpansion?.finishIfCleared(actor,context.teamOpening);
    const previous = attackScopes.get(actor);
    const scope = previous || { stopped: false };
    if (!previous) attackScopes.set(actor, scope);
    const alliance = actor.allianceBehavior;
    const previousAllianceScope = alliance ? attackScopes.get(alliance) : undefined;
    if (alliance) attackScopes.set(alliance, scope);
    try {
      return await deps.attackSequencePlanner.run(actor, context, {
        crossWilderness:deps.wildernessCrossing?()=>planWildernessCrossing(actor):undefined,
        supportPosture:()=>supportPosture(actor),
        allowed: () => deps.enabled() && deps.isCurrent(controller.bot) && !deps.isPublic(controller.bot.mg) && !scope.stopped,
        choose: (domain, candidates, facts) => {
          const choice = controller.engine.decide({
            ...safe(() => snapshot(controller), { unavailable: true }), domain, attackSequence: facts,
            teamOpening: context.teamOpening,supportPosture:supportPosture(actor),
            ...(activePlans.has(actor) ? { parentDecisionId: activePlans.get(actor) } : {})
          }, candidates);
          if (!candidates.some(c => c.id === choice.selectedId && c.kind === domain && c.eligible)) scope.stopped = true;
          return choice;
        },
        execute: (decisionId, execute) => withCombatDiplomacyPlan(actor, decisionId, execute),
        record: (kind, details) => controller.engine.record(kind, details)
      });
    } finally {
      if (!previous) attackScopes.delete(actor);
      if (alliance) {
        if (previousAllianceScope === undefined) attackScopes.delete(alliance);
        else attackScopes.set(alliance, previousAllianceScope);
      }
    }
  }
  async function planAttacks(actor, friends, enemies) {
    const previous = attackScopes.get(actor);
    if (!previous) attackScopes.set(actor, { stopped: false });
    try { return await deps.attackPlanner.run(actor, friends, enemies, attackHooks(actor)); }
    finally {
      if (previous === undefined) attackScopes.delete(actor);
      else attackScopes.set(actor, previous);
    }
  }
  function selectAttackTarget(actor, mode, targets) {
    const hooks = attackHooks(actor);
    const choice = deps.attackPlanner.select(actor, mode, targets, hooks);
    const scope = attackScopes.get(actor);
    if (choice.target && scope) scope.decisionId = choice.decisionId;
    // counterReady is an original synchronous routine. Its nested lookup must
    // communicate an explicit policy stop without changing its boolean API.
    if (choice.stop && scope) {
      scope.stopped = true;
      hooks.record('attack-stop', { decisionId: choice.decisionId, mode, reason: 'Target policy stopped the enclosing attack pass' });
    }
    return choice.target;
  }
  async function chooseAttackGeography(actor, mode) {
    const hooks = attackGeographyHooks(actor);
    const choice = await deps.attackGeographyPlanner.select(actor, mode, hooks);
    const scope = attackScopes.get(actor);
    if (choice.stop && scope) {
      scope.stopped = true;
      hooks.record('attack-stop', { decisionId: choice.decisionId, mode,
        reason: 'Geographic target policy stopped the enclosing attack pass' });
    }
    return choice;
  }
  async function selectAttackGeography(actor, mode) {
    return (await chooseAttackGeography(actor, mode)).target;
  }
  function replay(strategyId, trace) {
    if (!current) throw new Error('Enter a private game before replaying a trace.');
    return current.engine.replay(strategyId, trace);
  }
  return { attach, attachBehaviors, begin, intent, build, callback, diplomacyIntent, diplomacyCallback, decideAlliance,
    allianceDecisionStopped: actor => diplomacyStops.get(actor) === true,
    planBuilding, buildingAllowed, defenseEconomyFacts, twoTeamOpeningVeto, twoTeamOpeningTileVeto,
    planAttackSequence, planAttackAllocation, planAttackRoute, planTargetedBoat, planFreeBoat, planEmbargos, planSpawn, planDonation, planAllianceOutreach, planFarOutreach,
    chooseBoatOrigin, chooseBoatCrater, planBoatSites, launchBoat, planTacticalBoat, findEnemyProbeTarget,
    selectWarshipSpawn, selectMovingWarship, selectWarshipWaypoint,
    selectWarshipHome, selectWarshipNukeEscape, planWarshipNukeDodge,
    planWarshipThreatPass, selectWarshipThreat, warshipThreatAllowed,
    planOutgoingShips, planWarshipTracking,
    planSocial, selectSocialRecipient, socialRecipientAction, planSmallAttackEmoji,
    planEmojiRequest, planSocialWinner, markSocialWinner, emojiPermission, selectSocialMessage, selectSocialPool,
    planAllianceEvents,
    allianceEventStopped,
    planSocialReaction,
    supportPosture,probeThrottle,planWildernessCrossing,
    planTurn, planWarshipMaintenance, planAssist, planBetray, planStructures, planStructurePlacement, planBotTargets, planAttacks, selectAttackTarget, selectAttackGeography, planNavalLanding, planNavalActions, planWarshipPatrol, planWarshipCombat, planWarshipRetaliation, planIncomingTransports, planWarshipDeployment, planWarshipInfestation, selectWarshipInfestation, planMirv, selectNukeWeapon, planNuke, selectNukeTarget, planSamClear, planHelpfulSilo, selectNukeArc, planSaturationSalvo, strikeDecisionId, selectStrikePlayer, strikeBuild, strikeAllowed, inspect, replay, wasDeclined: actor => declined.get(actor) === true,
    select: id => { if (!current) throw new Error('No active bot.'); current.engine.select(id); },
    strategies: () => current?.engine.strategies() || [] };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createBrainRuntime;
