// Constructor fixtures transcribed from public OpenFront Transport.ts at
// 420f27a33a0e321a4258062558da38554eea1661 (2026-10-18).
// Source: https://github.com/openfrontio/OpenFrontIO/blob/420f27a33a0e321a4258062558da38554eea1661/src/client/Transport.ts
class SendSpawnIntentEvent {
    tile;
    constructor(tile){
        this.tile = tile;
    }
}

class SendAttackIntentEvent {
    targetID;
    troops;
    constructor(targetID, troops){
        this.targetID = targetID;
        this.troops = troops;
    }
}

class SendBoatAttackIntentEvent {
    dst;
    troops;
    constructor(dst, troops){
        this.dst = dst;
        this.troops = troops;
    }
}

class MoveWarshipIntentEvent {
    unitIds;
    tile;
    constructor(unitIds, tile){
        this.unitIds = unitIds;
        this.tile = tile;
    }
}

class SendDonateTroopsIntentEvent {
    recipient;
    troops;
    constructor(recipient, troops){
        this.recipient = recipient;
        this.troops = troops;
    }
}

class SendEmbargoIntentEvent {
    target;
    action;
    constructor(target, action){
        this.target = target;
        this.action = action;
    }
}

class SendEmojiIntentEvent {
    recipient;
    emoji;
    constructor(recipient, emoji){
        this.recipient = recipient;
        this.emoji = emoji;
    }
}

class SendTargetPlayerIntentEvent {
    targetID;
    constructor(targetID){
        this.targetID = targetID;
    }
}

module.exports={SendSpawnIntentEvent,SendAttackIntentEvent,SendBoatAttackIntentEvent,MoveWarshipIntentEvent,SendDonateTroopsIntentEvent,SendEmbargoIntentEvent,SendEmojiIntentEvent,SendTargetPlayerIntentEvent};

class SendEmbargoAllIntentEvent {constructor(action){this.action=action;}}
module.exports.SendEmbargoAllIntentEvent=SendEmbargoAllIntentEvent;
