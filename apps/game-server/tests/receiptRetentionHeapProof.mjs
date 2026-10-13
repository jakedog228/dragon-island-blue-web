// Isolated store/GC proof. No live server data, browser profile, or game state is read.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const { FileAuthoritativeSlotStore } = await import(process.env.DIB_RECEIPT_STORE_MODULE ?? '../src/fileSlotStore.ts');
import { readStoredReceipt } from '../../../packages/game-service/src/index.ts';
assert(global.gc, 'Run node --expose-gc --import ./apps/game-server/node_modules/tsx/dist/loader.mjs');
const output=path.resolve(process.argv[2]); assert(!fs.existsSync(output)); fs.mkdirSync(output,{recursive:true});
const playerId='d'.repeat(64), logicPackId=`logic-v1:${'e'.repeat(64)}`, simulationVersion='official-game-v11';
const store=new FileAuthoritativeSlotStore({dataDirectory:path.join(output,'isolated-store'),logicPackId,simulationVersion,worldId:'Proof',
  parseState:v=>v, parseProjection:v=>v, parseCommandResult:v=>v});
const weak=[];
async function append(revision) {
  await store.transact(playerId,'slot-1',async current=>{
    const commandId=`heap_proof_command_${revision}`;
    const projection={slotId:'slot-1',revision,logicPackId,simulationVersion,trustTier:'official',
      // Distinct substantial arrays expose retention; this is an isolated storage fixture.
      payload:Array.from({length:20000},(_,i)=>`${revision}:${i}`)};
    const result={commandId,revision,projection}; weak.push(new WeakRef(result));
    const receipts=new Map(current?.receipts ?? []);
    receipts.set(commandId,{canonicalEnvelope:JSON.stringify({protocolVersion:'game-protocol-v1',commandId,
      expectedRevision:revision-1,command:{type:'world.navigate',targetPoiId:'Town'}}),result});
    return {record:Object.freeze({playerId,slotId:'slot-1',logicPackId,simulationVersion,revision,eventCursor:revision,
      updatedAt:new Date().toISOString(),state:{revision},projection,receipts}),value:undefined};
  });
}
for(let r=1;r<=256;r++) await append(r);
const collect=async()=>{for(let i=0;i<4;i++){await new Promise(resolve=>setImmediate(resolve)); global.gc();}};
await collect();
let retainedWarm=weak.filter(ref=>ref.deref()!==undefined).length;
console.log(JSON.stringify({stage:'warm',retainedWarm,commands:256}));
assert(retainedWarm<=64, `Warm results leaked: ${retainedWarm}/256`);
const current=await store.read(playerId,'slot-1');
const replayWeak=[];
async function replay(index){const result=await readStoredReceipt(current.receipts.get(`heap_proof_command_${index}`));
  assert.equal(result.revision,index); replayWeak.push(new WeakRef(result));}
for(let i=1;i<=128;i++) await replay(i);
await collect();
const retainedReplays=replayWeak.filter(ref=>ref.deref()!==undefined).length;
assert(retainedReplays<=32,`Replay results leaked: ${retainedReplays}/128`);
await replay(1); // Evicted exact result remains readable from its immutable sidecar.
const report={passed:true,commands:256,replayed:128,retainedWarm,retainedReplays,heapUsed:process.memoryUsage().heapUsed,
  historicalReceiptCount:current.receipts.size,fixtureOnly:true};
fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
