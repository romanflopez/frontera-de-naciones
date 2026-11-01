/**
 * Constructores de mensajes del server. Port de los Create* de NetworkManager.cs que usa este corte.
 */
import { ServerMessage, type DeepPartial, type PlayerEnteredRange } from '@fdn/proto';
import type { Catalogs, GameWorldConfig, ItemConfig, SpellConfig } from './config.ts';
import type { Player } from './player.ts';
import type { Econ, SItem } from './economy.ts';

type Payload = NonNullable<DeepPartial<ServerMessage>['payload']>;
const msg = (payload: Payload): ServerMessage => ServerMessage.fromPartial({ payload });

export function worldsList(worlds: GameWorldConfig[]): ServerMessage {
    return msg({ $case: 'worldsList', value: { worlds: worlds.map((w) => ({ id: w.id, name: w.name, map: w.map })) } });
}

export function monstersList(catalogs: Catalogs): ServerMessage {
    return msg({ $case: 'monstersList', value: { monsters: catalogs.monsters.map((m) => ({ name: m.name, sprite: m.sprite })) } });
}

function spellEntry(s: SpellConfig) {
    return {
        id: s.id, name: s.name, damageType: s.damageType, aoeRadius: s.aoeRadius, projectileSpeed: s.projectileSpeed,
        emissionSteps: s.emissionSteps, startRadius: s.startRadius, endRadius: s.endRadius, startShards: s.startShards,
        endShards: s.endShards, durationMs: s.duration, projectileDistancePx: s.projectileDistance,
        aimAssist: s.aimAssist === true ? true : undefined,
        temporaryEffects: (s.temporaryEffects ?? []).map((fx) => ({
            type: fx.type, durationMs: fx.duration, group: fx.group,
            movementSpeedModifier: fx.movementSpeedModifier, attackSpeedModifier: fx.attackSpeedModifier, castSpeedModifier: fx.castSpeedModifier,
        })),
    };
}

function itemDirectoryEntry(i: ItemConfig) {
    return {
        id: i.id, name: i.name, itemType: i.itemType, blockedItemSlots: i.blockedItemSlots ?? [],
        stackable: i.stackable === true ? true : undefined, consumable: i.consumable === true ? true : undefined,
        effects: (i.effects ?? []).map((fx) => ({ effect: fx.effect, effectColor: fx.effectColor })),
        weaponType: i.weaponType, equipGender: i.gender,
    };
}

export function initialState(p: Player, catalogs: Catalogs, opts: { includeSpells: boolean; pingIntervalMs: number; arrowSpeed: number; pickupMs: number; bowMs: number }): ServerMessage {
    return msg({
        $case: 'initialState',
        value: {
            spells: opts.includeSpells ? catalogs.spells.map(spellEntry) : [],
            playerId: p.playerId,
            movementSpeedMs: p.movementSpeedMs,
            baseMovementSpeedMs: p.baseMovementMs,
            runningMode: p.runningMode,
            pingIntervalMs: opts.pingIntervalMs,
            attackMode: p.attackMode,
            attackRangeCells: p.attackRangeCells,
            attackDamage: p.damage,
            attackSpeedMs: p.attackSpeedMs,
            arrowSpeedPxPerSec: opts.arrowSpeed,
            hp: p.hp,
            maxHp: p.maxHp,
            playerPickupAnimationTimeMs: opts.pickupMs,
            playerBowAnimationDurationMs: opts.bowMs,
            attackStunDurationMs: p.attackStunDurationMs,
            castSpeedMs: p.castSpeedMs,
            attackType: p.attackType,
            allowDashAttack: p.allowDashAttack,
            itemsDirectory: catalogs.items.map(itemDirectoryEntry),
            bagItems: [],
            equippedItems: [],
            gender: p.gender,
            skinColor: p.skinColor,
            hairStyleIndex: p.hairStyleIndex,
            underwearColorIndex: p.underwearColorIndex,
            npcDirectory: catalogs.npcs.map((n) => ({ id: n.id, name: n.name })),
        },
    });
}

export function initialGameWorldState(world: GameWorldConfig, p: Player): ServerMessage {
    return msg({
        $case: 'initialGameWorldState',
        value: {
            gameWorldId: world.id,
            mapName: world.map,
            musicFile: world.music ?? '',
            playerX: p.posX,
            playerY: p.posY,
            playerDirection: p.facingDirection,
            dead: p.isDead,
            weather: 0,
            teleportLocs: (world.teleportLocs ?? []).map((t) => ({
                locs: t.locs.map((l) => ({ x: l.x, y: l.y })),
                target: { worldId: t.target.worldId, mapName: '', loc: { x: t.target.loc.x, y: t.target.loc.y } },
            })),
        },
    });
}

export function mapTransfer(o: { mapId: string; name: string; x: number; y: number; direction: number; hash: string; music: string; gameWorldId: string; lvl: [number, number] | null }): ServerMessage {
    return msg({ $case: 'mapTransfer', value: { mapId: o.mapId, name: o.name, x: o.x, y: o.y, direction: o.direction, mapHash: o.hash, musicFile: o.music, gameWorldId: o.gameWorldId, lvlMin: o.lvl?.[0] ?? 0, lvlMax: o.lvl?.[1] ?? 0 } });
}

export function playerSnapshot(p: Player): PlayerEnteredRange {
    return {
        playerId: p.playerId,
        x: p.posX,
        y: p.posY,
        movementSpeedMs: p.movementSpeedMs,
        runningMode: p.runningMode,
        spawnProtection: p.spawnProtection,
        direction: p.facingDirection,
        attackMode: p.attackMode,
        dead: p.isDead,
        visibleEquippedItems: [],
        gender: p.gender,
        skinColor: p.skinColor,
        hairStyleIndex: p.hairStyleIndex,
        underwearColorIndex: p.underwearColorIndex,
        characterName: p.characterName,
        activeTemporaryEffects: [],
        attackSpeedMs: p.attackSpeedMs,
        castSpeedMs: p.castSpeedMs,
        profile: p.profile,
    };
}

export const playersEnteredRange = (players: Iterable<Player>): ServerMessage =>
    msg({ $case: 'playersEnteredRange', value: { players: [...players].map(playerSnapshot) } });

export const playersLeftRange = (ids: Iterable<bigint>): ServerMessage =>
    msg({ $case: 'playersLeftRange', value: { playerIds: [...ids] } });

export const playerMoved = (id: bigint, curX: number, curY: number, destX: number, destY: number, movementSpeedMs: number, runningMode: boolean, dashAttack: boolean, teleport = false): ServerMessage =>
    msg({ $case: 'playerMoved', value: { playerId: id, curX, curY, destX, destY, movementSpeedMs, runningMode, dashAttack, teleport } });

export const resetPosition = (gameWorldId: string, x: number, y: number, remainingStunlockMs = 0): ServerMessage =>
    msg({ $case: 'resetPosition', value: { x, y, gameWorldId, remainingStunlockMs } });

export const positionCorrected = (gameWorldId: string, curX: number, curY: number, destX: number, destY: number): ServerMessage =>
    msg({ $case: 'positionCorrected', value: { curX, curY, destX, destY, gameWorldId } });

export const playerMovementStateChanged = (id: bigint, runningMode: boolean, movementSpeedMs: number): ServerMessage =>
    msg({ $case: 'playerMovementStateChanged', value: { playerId: id, runningMode, movementSpeedMs } });

export const playerAttackModeChanged = (id: bigint, attackMode: boolean): ServerMessage =>
    msg({ $case: 'playerAttackModeChanged', value: { playerId: id, attackMode } });

export const playerIdleDirectionChanged = (id: bigint, direction: number): ServerMessage =>
    msg({ $case: 'playerIdleDirectionChanged', value: { playerId: id, direction } });

export const playerAppearanceChanged = (p: Player): ServerMessage =>
    msg({ $case: 'playerAppearanceChanged', value: { playerId: p.playerId, gender: p.gender, skinColor: p.skinColor, hairStyleIndex: p.hairStyleIndex, underwearColorIndex: p.underwearColorIndex } });

export const playerParalyzed = (durationSeconds: number): ServerMessage => msg({ $case: 'playerParalyzed', value: { durationSeconds } });
export const sendMessage = (text: string): ServerMessage => msg({ $case: 'sendMessage', value: { message: text } });
export const playerDisconnected = (id: bigint): ServerMessage => msg({ $case: 'playerDisconnected', value: { playerId: id } });
export const playerReconnected = (id: bigint): ServerMessage => msg({ $case: 'playerReconnected', value: { playerId: id } });
export const spawnProtectionEnabled = (id: bigint): ServerMessage => msg({ $case: 'spawnProtectionEnabled', value: { playerId: id } });
export const spawnProtectionDisabled = (id: bigint): ServerMessage => msg({ $case: 'spawnProtectionDisabled', value: { playerId: id } });
export const playerTeleported = (x: number, y: number): ServerMessage => msg({ $case: 'playerTeleported', value: { x, y } });
export const logoutResponse = (wait: number): ServerMessage => msg({ $case: 'logoutResponse', value: { wait } });

export const pingResponse = (sequence: number, gameWorldQueueLength: number, playersInMap: number, pingVariance: number): ServerMessage =>
    msg({ $case: 'pingResponse', value: { sequence, gameWorldQueueLength, playersInMap, pingVariance } });

export const chatMessageReceived = (senderCharacterName: string, text: string): ServerMessage =>
    msg({ $case: 'chatMessageReceived', value: { senderCharacterName, timestampMs: BigInt(Date.now()), message: text } });

export const playerProfileChanged = (p: Player): ServerMessage =>
    msg({ $case: 'playerProfileChanged', value: { playerId: p.playerId, profile: p.profile } });

export const pvpHit = (casterId: bigint, v: { fx: string; x: number; y: number; targetId: bigint; dmg: number; secs: number; r: number }): ServerMessage =>
    msg({ $case: 'pvpHit', value: { casterId, ...v } });

export const characterLoaded = (exists: boolean, data: string): ServerMessage => msg({ $case: 'characterLoaded', value: { exists, data } });
// ---------- PvE autoritativo ----------
export const mobsSnapshot = (mobs: { id: number; type: number; zone: number; x: number; y: number; hp: number; par: number; imm: number; poison: boolean; moving: boolean }[]): ServerMessage =>
    msg({ $case: 'mobsSnapshot', value: { mobs } });
export const mobDamaged = (mobId: number, attackerId: bigint, dmg: number, crit: boolean, hp: number): ServerMessage =>
    msg({ $case: 'mobDamaged', value: { mobId, attackerId, dmg, crit, hp } });
export const mobAttack = (mobId: number, tx: number, ty: number): ServerMessage => msg({ $case: 'mobAttack', value: { mobId, tx, ty } });
export const mobHitPlayer = (mobId: number, dmg: number, stun: number): ServerMessage => msg({ $case: 'mobHitPlayer', value: { mobId, dmg, stun } });
export const mobProjectile = (mobId: number, fromX: number, fromY: number, toX: number, toY: number, travelMs: number, kind: number): ServerMessage => msg({ $case: 'mobProjectile', value: { mobId, fromX, fromY, toX, toY, travelMs, kind } });
export const mobSpecialEvent = (mobId: number, phase: number, x: number, y: number): ServerMessage => msg({ $case: 'mobSpecialEvent', value: { mobId, phase, x, y } });
export const lootRoll = (mobId: number, rarity: number, baseSeed: number, attrs: { key: string; value: number }[]): ServerMessage =>
    msg({ $case: 'lootRoll', value: { mobId, rarity, baseSeed, attrs } });
export const statusUpdate = (playerId: bigint, invisible: boolean, detect: boolean, fury = false, warcry = false, slow = false): ServerMessage =>
    msg({ $case: 'statusUpdate', value: { playerId, invisible, detect, fury, warcry, slow } });
export const skillEffect = (casterId: bigint, skill: string, fromX: number, fromY: number, toX: number, toY: number, ok = true): ServerMessage =>
    msg({ $case: 'skillEffect', value: { casterId, skill, fromX, fromY, toX, toY, ok } });
export const vitals = (hp: number, maxHp: number, dead: boolean, mp: number, maxMp: number): ServerMessage => msg({ $case: 'vitals', value: { hp, maxHp, dead, mp, maxMp } });
export const playerVitals = (playerId: bigint, hp: number, maxHp: number): ServerMessage => msg({ $case: 'playerVitals', value: { playerId, hp, maxHp } });
export const pvpKill = (playerId: bigint, killerId: bigint, victimName: string, killerName: string): ServerMessage =>
    msg({ $case: 'pvpKill', value: { playerId, killerId, victimName, killerName } });
export const mobDied = (mobId: number, killerId: bigint, x: number, y: number, type: number, zone: number): ServerMessage =>
    msg({ $case: 'mobDied', value: { mobId, killerId, x, y, type, zone } });

// ---------- economía (ver economy.ts) ----------
const invItem = (i: SItem) => ({ uid: i.u, base: i.n, rarity: i.r, attrs: i.a.map((a) => ({ id: a.id, v: a.v })) });
export const inventoryState = (st: Econ): ServerMessage => msg({
    $case: 'inventoryState',
    value: {
        gold: Math.min(2147483647, st.gold), goldD: st.gold, lvl: st.lvl, exp: st.exp, bag: st.bag.map(invItem),
        eq: (Object.keys(st.eq) as (keyof Econ['eq'])[]).flatMap((slot) => (st.eq[slot] ? [{ slot, item: invItem(st.eq[slot]!) }] : [])),
        potsHp: st.pots.hp, potsMp: st.pots.mp,
        questI: st.q.i, questState: st.q.st, questProg: st.q.prog,
        keysCripta: st.q.keys.cripta, keysFoso: st.q.keys.foso, shardsCripta: st.q.shards.cripta, shardsFoso: st.q.shards.foso,
        unlocked: st.u, cls: st.cls, faction: st.faction,
    },
});
export const econResult = (ok: boolean, code: string, text: string): ServerMessage => msg({ $case: 'econResult', value: { ok, code, text } });
export const killReward = (v: { mobId: number; x: number; y: number; exp: number; gold: number; goldD?: number; item?: ReturnType<typeof invItem>; bagFull: boolean; potion: string; shard: string; newLvl: number; questReady: boolean; questProg: number }): ServerMessage =>
    msg({ $case: 'killReward', value: { ...v, gold: Math.min(2147483647, v.gold), goldD: v.gold } });
export const groundItemSpawned = (g: { id: number; item: SItem; x: number; y: number }, locked: boolean, freeInMs: number, expiresInMs: number): ServerMessage =>
    msg({ $case: 'groundItemSpawned', value: { id: g.id, item: invItem(g.item), x: g.x, y: g.y, locked, freeInMs: Math.max(0, Math.round(freeInMs)), expiresInMs: Math.max(0, Math.round(expiresInMs)) } });
export const groundItemRemoved = (id: number): ServerMessage => msg({ $case: 'groundItemRemoved', value: { id } });
/** Estado del recall (volver a la ciudad) para el que lo usa: canalizando (con lo que falta) o nada, el enfriamiento y el motivo de un corte. */
export const recallState = (channeling: boolean, channelMs: number, remainingMs: number, cooldownMs: number, reason = ''): ServerMessage =>
    msg({ $case: 'recallState', value: { state: channeling ? 1 : 0, channelMs, remainingMs: Math.max(0, Math.round(remainingMs)), cooldownMs: Math.max(0, Math.round(cooldownMs)), reason } });

export const partyState = (members: { name: string; level: number; hp: number; maxHp: number; map: string; leader: boolean; online: boolean }[]): ServerMessage => msg({ $case: 'partyState', value: { members } });
export const partyInvited = (fromName: string, expiresMs: number): ServerMessage => msg({ $case: 'partyInvited', value: { fromName, expiresMs: BigInt(expiresMs) } });
