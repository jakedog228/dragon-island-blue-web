// Opt-in muted native capture regression. Standalone fixture: no campaign credit.
// Official mode uses the trusted isolated fixture from tools/browser/prepare-job-level-capture.mts.
// It also verifies authoritative settlement and a full browser reload. No campaign credit.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {loadLocalContent} from './localContent.mjs';
import {clickNativeLabel,waitNativeLabel} from './nativeLabelInput.mjs';
import {createFrameCapture} from './captureFrame.mjs';
const official=process.env.DIB_JOB_LEVEL_OFFICIAL==='1';
const token=official?fs.readFileSync(process.env.DIB_TEST_AUTH_FILE,'utf8').trim():undefined;
const webUrl=process.env.DIB_WEB_URL??'http://127.0.0.1:5173';
const output=path.resolve(process.env.DIB_OUTPUT_DIR??'output/job-level-capture');
fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--mute-audio','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:960,height:640},recordVideo:{dir:output,size:{width:960,height:640}}});
const page=await context.newPage(),errors=[],capture=await createFrameCapture(page,output);
page.on('pageerror',e=>errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('favicon'))errors.push(m.text());});
const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
const advance=async(ms=100)=>{await page.evaluate(ms=>window.advanceTime(ms),ms);await page.waitForTimeout(5);};
let latest,done=false,opened=false,selected=false;
let projection;
const receipts=new Set();
page.on('response',response=>{
 if(!/\/api\/game\/slots\/slot-1\/(commands|bootstrap)$/.test(new URL(response.url()).pathname))return;
 const work=(async()=>{const body=await response.json();assert(response.ok());projection=body.projection??body;})();
 receipts.add(work);work.finally(()=>receipts.delete(work)).catch(e=>errors.push(String(e)));
});
async function onlineGate(){
 await page.locator('input[name="asset-archive"]').setInputFiles(process.env.DIB_CONTENT_ARCHIVE??path.resolve('Dragon_Island_Blue_1.1.0.ipa'));
 await page.getByLabel('Online (Beta)',{exact:true}).check();
 await page.getByLabel('Login token').fill(token);
 await page.getByRole('button',{name:'Log in',exact:true}).click();
 await page.locator('.content-gate__login-status--success').waitFor({timeout:60000});
 await page.locator('.content-gate__rights input').check();
 await page.getByRole('button',{name:'Play Online',exact:true}).click();
 await page.waitForFunction(()=>typeof window.render_game_to_text==='function');
}
try{
 await page.addInitScript(official=>{
  window.advanceTime=()=>Promise.resolve();window.__DIB_TEST_BATTLE_SEED__=777;
  localStorage.setItem('dib.portSettings.v1',JSON.stringify({displayMode:'iphone',sound:0,music:0}));
  if(official){window.__DIB_TEST_WORLD_DEMO__=true;return;}
  window.__DIB_TEST_PLAYER_PROFILE__={heroLevel:24,monsterPartyLevels:[150],silver:2000,gold:0,captureCards:{1:0,2:0,3:1},tutorialFlags:['Tutorial0','Tutorial1','Tutorial2','flashTownExit']};
  window.__DIB_TEST_ENCOUNTER__={backgroundKey:'FieldCombat',playerTeam:[{shortType:'FireTiger',level:150}],enemyTeam:[{shortType:'Centurion',level:151}]};
 },official);
 await page.goto(webUrl);if(official)await onlineGate();else await loadLocalContent(page);
 const deadline=Date.now()+180000;
 for(let tick=0;tick<6000;tick++){
  assert(Date.now()<deadline,'Capture boundary proof exceeded three minutes');latest=await state();assert.deepEqual(errors,[]);
  if(tick%40===0)console.log(JSON.stringify({tick,mode:latest.mode,phase:latest.presentation?.state,popup:latest.activePopup}));
  if(latest.tutorial?.okReady)await page.keyboard.press('Enter');
  else if(latest.mode==='start'){
   await advance(500);
   if(latest.startup.phase==='title')await clickNativeLabel(page,'sourceTitleTouchLayer');
   else if(latest.startup.phase==='save-select')await clickNativeLabel(page,'sourcePopupButton:slot-1');
  }else if(latest.statusText?.visible)await page.keyboard.press('Enter');
  else if(latest.activePopup==='captureChooser'&&!selected){
   await waitNativeLabel(page,'captureCardChoice3');await advance(300);await capture('capture-chooser.png');
   fs.writeFileSync(path.join(output,'chooser.json'),JSON.stringify(latest,null,2));
   await clickNativeLabel(page,'captureCardChoice3');selected=true;
  }else if(latest.presentation?.state==='battleEnded'&&latest.activePopup==='xpAward'){
   assert(opened&&selected);assert.deepEqual(latest.capture.pendingCapturedIds,['t1m0:Centurion']);
   assert.equal(latest.capture.inventory.captureCards[3],0);
   await capture('victory.png');done=true;break;
  }else if(latest.presentation?.state==='awaitingPlayerChoice'&&latest.panelVisible&&!latest.turnOrderAnimating&&!latest.activePopup&&!opened){
   assert.equal(latest.monsters.find(m=>m.id==='t1m0:Centurion')?.level,150,'Job constructor must clamp display and capture level');
   await capture('constructed-level.png');fs.writeFileSync(path.join(output,'before.json'),JSON.stringify(latest,null,2));
   await clickNativeLabel(page,'captureCardHit');opened=true;
  }
  await advance(150);
 }
 assert(done,'Capture did not reach victory');
 if(official){
  await Promise.all([...receipts]);
  assert.equal(projection.simulationVersion,'official-game-v27');
  assert.equal(projection.player.party.filter(m=>m.shortType==='Centurion'&&m.level===150).length,1);
  const committed=structuredClone(projection);
  await page.reload();await onlineGate();
  let resumed=false;
  for(let tick=0;tick<1200;tick++){
   latest=await state();assert.deepEqual(errors,[]);
   if(latest.mode==='world'||latest.mode==='town'){
    assert.equal(latest.player.party.filter(m=>m.shortType==='Centurion'&&m.level===150).length,1);
    resumed=true;await capture('reloaded-capture.png');break;
   }
   if(latest.mode==='start'){
    await advance(500);
    if(latest.startup.phase==='title')await clickNativeLabel(page,'sourceTitleTouchLayer');
    else if(latest.startup.phase==='save-select')await clickNativeLabel(page,'sourcePopupButton:slot-1');
   }else if(latest.tutorial?.okReady)await page.keyboard.press('Enter');
   await advance(150);
  }
  assert(resumed,'Official capture did not survive browser reload');
  await Promise.all([...receipts]);
  assert.equal(projection.player.party.filter(m=>m.shortType==='Centurion').length,1);
  fs.writeFileSync(path.join(output,'committed.json'),JSON.stringify(committed,null,2));
 }

 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,official,requestedLevel:151,constructedLevel:150,campaignCredit:false,errors,final:latest},null,2));
 console.log('job-level capture UI: PASS');
}catch(error){fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:token?String(error).replaceAll(token,'[redacted]'):String(error),latest,errors},null,2));await capture('failure.png');throw new Error(token?String(error).replaceAll(token,'[redacted]'):String(error));}
finally{await context.close();await browser.close();}
