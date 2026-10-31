/**
 * Depósito (baúl/banco) por cuenta: reglas compartidas entre cliente y server. El server valida TODO con estas
 * constantes; el cliente solo las usa para dibujar (capacidad, topes, nombres). Ver docs/DEPOSITO.md.
 *
 * El NPC se reconoce por su rol (`roleOf(npc) === 'depositario'`), no por su posición: sirve en cualquier mapa.
 */
import { KEYDEFS, POT_MAX, POTS, type KeyId, type PotKind } from './economy';

/** Rol del NPC que atiende el depósito (ids `depositario_s`, `depositario_v`, ...). */
export const DEPOT_ROLE = 'depositario';
/** Casillas de equipo del depósito. */
export const DEPOT_SLOTS = 48;
/** Tope de cada stack de consumibles/materiales dentro del depósito. */
export const DEPOT_STACK_MAX = 9999;
/** Tope de llaves y esquirlas que se pueden llevar encima (el mismo que usa la economía del server). */
export const MAT_MAX = 99;

/** Stacks que se pueden guardar: pociones, llaves y esquirlas. */
export type DepotStackId = 'pot_hp' | 'pot_mp' | 'key_cripta' | 'key_foso' | 'shard_cripta' | 'shard_foso';
export interface DepotStackDef { id: DepotStackId; name: string; kind: 'pot' | 'key' | 'shard'; ref: PotKind | KeyId; carryMax: number }
export const DEPOT_STACKS: DepotStackDef[] = [
    { id: 'pot_hp', name: POTS.hp.name, kind: 'pot', ref: 'hp', carryMax: POT_MAX },
    { id: 'pot_mp', name: POTS.mp.name, kind: 'pot', ref: 'mp', carryMax: POT_MAX },
    { id: 'key_cripta', name: KEYDEFS.cripta.name, kind: 'key', ref: 'cripta', carryMax: MAT_MAX },
    { id: 'key_foso', name: KEYDEFS.foso.name, kind: 'key', ref: 'foso', carryMax: MAT_MAX },
    { id: 'shard_cripta', name: KEYDEFS.cripta.shard, kind: 'shard', ref: 'cripta', carryMax: MAT_MAX },
    { id: 'shard_foso', name: KEYDEFS.foso.shard, kind: 'shard', ref: 'foso', carryMax: MAT_MAX },
];
export const DEPOT_STACK_BY_ID = new Map(DEPOT_STACKS.map((s) => [s.id, s]));
/** Acciones del pedido `DepositRequest.action`. */
export const DEPOT_ACTIONS = ['open', 'put', 'take', 'gold_in', 'gold_out', 'stack_in', 'stack_out', 'sort'] as const;
export type DepotAction = (typeof DEPOT_ACTIONS)[number];
