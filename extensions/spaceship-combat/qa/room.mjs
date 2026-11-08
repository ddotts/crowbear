import assert from "node:assert/strict";
import { chromium } from "playwright";

// An SDK host fixture, not an Owlbear or Dice+ service substitute. It exercises
// the real installed SDK, background iframe, GM panel and two player panels.
const base = (process.env.CROWBEAR_QA_URL ?? "http://127.0.0.1:5174").replace(
  /\/$/,
  "",
);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const host = `<!doctype html><html><body style="display:flex;gap:10px;background:#ddd"><script>
const origin=location.origin;
const appBase=${JSON.stringify(new URL(base).pathname.replace(/\/$/, "") + "/")};
window.metadata={};window.rollRequests=[];window.remotePayloads=[];window.failSave=false;window.sceneReady=true;
const clients=[];
function send(client,id,data){client.frame.contentWindow.postMessage({id,data},origin);}
function emit(id,data){for(const client of clients)send(client,id,data);}
function broadcast(sender,channel,data,destination='REMOTE'){
 for(const client of clients){const local=client.connection===sender.connection;if(destination==='LOCAL'?!local:destination==='REMOTE'?local:false)continue;if(client.channels.has(channel))send(client,'OBR_BROADCAST_MESSAGE_'+channel,{connectionId:sender.connection,data});}
 if(destination!=='LOCAL')window.remotePayloads.push(JSON.stringify({channel,data}));
}
window.addEventListener('message',event=>{
 const client=clients.find(c=>c.frame.contentWindow===event.source);if(!client)return;
 const m=event.data;if(!m.id || !m.id.startsWith('OBR_'))return;
 let response={};let error;
 switch(m.id){
 case 'OBR_PLAYER_GET_CONNECTION_ID':response={connectionId:client.connection};break;
 case 'OBR_PLAYER_GET_ROLE':response={role:client.role};break;
 case 'OBR_PLAYER_GET_ID':response={id:client.user};break;
 case 'OBR_PLAYER_GET_NAME':response={name:client.user};break;
 case 'OBR_SCENE_IS_READY':response={ready:window.sceneReady};break;
 case 'OBR_SCENE_GET_METADATA':response={metadata:window.metadata};break;
 case 'OBR_SCENE_SET_METADATA':if(window.failSave){error='Simulated scene save failure';break;}Object.assign(window.metadata,m.data.update);emit('OBR_SCENE_METADATA_EVENT_CHANGE',{metadata:window.metadata});break;
 case 'OBR_PARTY_GET_PLAYERS':response={players:[...new Map(clients.filter(c=>c.connection!==client.connection).map(c=>[c.connection,{id:c.user,connectionId:c.connection,role:c.role}])).values()]};break;
 case 'OBR_THEME_GET_THEME':response={theme:{mode:'DARK',primary:{main:'#bb99ff',contrastText:'#25143d',light:'#ddccff',dark:'#8855cc'},secondary:{main:'#ffcc88',contrastText:'#000',light:'#ffeedd',dark:'#bb8844'},background:{default:'#18181f',paper:'#252530'},text:{primary:'#eeeeee',secondary:'#b7b5c2',disabled:'#777'}}};break;
 case 'OBR_BROADCAST_SUBSCRIBE':client.channels.add(m.data.channel);break;
 case 'OBR_BROADCAST_UNSUBSCRIBE':client.channels.delete(m.data.channel);break;
 case 'OBR_BROADCAST_SEND_MESSAGE':{
   const {channel,data,options}=m.data;broadcast(client,channel,data,options?.destination);
   const dice={connection:'dice-service'};
   if(channel==='dice-plus/isReady' && !data.ready)broadcast(dice,channel,{requestId:data.requestId,ready:true,timestamp:Date.now()},'ALL');
   if(channel==='dice-plus/validate-notation' && data.valid===undefined)broadcast(dice,channel,{requestId:data.requestId,notation:data.notation,valid:true,timestamp:Date.now()},'ALL');
   if(channel==='dice-plus/roll-request'){window.rollRequests.push(data);broadcast(dice,data.source+'/roll-result',{rollId:data.rollId,playerId:data.playerId,playerName:data.playerName,rollTarget:data.rollTarget,timestamp:data.timestamp,result:{rollId:data.rollId,diceNotation:data.diceNotation,totalValue:12,rollSummary:'Fixture result',groups:[]}},'ALL');}
   break;
 }
 default:break;
 }
 if(m.nonce)send(client,m.id+(error?'_ERROR':'_RESPONSE')+m.nonce,error??response);
});
for(const [name,connection,user,role,background] of [['gm-background','gm-tab','gm-user','GM',true],['gm','gm-tab','gm-user','GM',false],['player','player-tab','player-user','PLAYER',false],['player-two','player-two-tab','player-two-user','PLAYER',false]]){
 const frame=document.createElement('iframe');frame.name=name;frame.style=background?'display:none':'width:400px;height:640px;border:0;border-radius:12px;';
 const client={frame,connection,user,role,channels:new Set()};clients.push(client);
 frame.src=appBase+(background?'background.html':'')+'?obrref='+encodeURIComponent(btoa(origin+' qa-room'));
 frame.onload=()=>send(client,'OBR_READY',{ref:name,userId:user});document.body.append(frame);
}
window.switchScene=(ready)=>{window.sceneReady=ready;if(ready)window.metadata={};emit('OBR_SCENE_EVENT_READY_CHANGE',{ready});};
</script></body></html>`;
await page.route(`${base}/qa-host`, (route) =>
  route.fulfill({ contentType: "text/html", body: host }),
);
await page.goto(`${base}/qa-host`);
const gm = page.frameLocator('iframe[name="gm"]');
const player = page.frameLocator('iframe[name="player"]');
const second = page.frameLocator('iframe[name="player-two"]');
await gm
  .locator(".connection-status")
  .getByText("Scene connected", { exact: false })
  .waitFor();
await player.locator(".ship-heading h2").waitFor();
assert.equal(await player.locator("#role").isDisabled(), true);
assert.doesNotMatch(
  await player.locator("main").innerText(),
  /Red Shrike|ISS Warden/,
);
await player
  .getByRole("button", { name: "Damage Engines", exact: true })
  .click();
await page.waitForFunction(
  () => Object.values(window.metadata)[0]?.ships[0].parts[1].damage === 1,
);
await gm.locator(".systems").getByText("1/3", { exact: true }).waitFor();
// Two players editing different systems in parallel must both be retained.
await Promise.all([
  player.getByRole("button", { name: "Damage Engines", exact: true }).click(),
  second.getByRole("button", { name: "Damage Weapons", exact: true }).click(),
]);
await page.waitForFunction(() => {
  const s = Object.values(window.metadata)[0]?.ships[0];
  return s?.parts[1].damage === 2 && s.parts[2].damage === 1;
});
await gm.getByRole("button", { name: "Stations", exact: true }).click();
await gm.locator('[data-action="configure"][data-value="flight-mode"]').click();
await gm.locator('[data-form="effects"] input[value="boost"]').check();
await gm.getByRole("button", { name: "Apply effects", exact: true }).click();
await page.waitForFunction(() =>
  Object.values(window.metadata)[0]?.ships[0].stations[0].selectedEffects[
    "flight-mode"
  ]?.includes("boost"),
);
await player.getByRole("button", { name: "Stations", exact: true }).click();
await player.locator('[data-action="seat"][data-station="0"]').click();
await player.locator("#crew-select").selectOption("");
await player.locator('[data-form="seat"] button.primary').click();
await page.waitForFunction(
  () =>
    Object.values(window.metadata)[0]?.ships[0].stations[0].seats[0] === null,
);
assert.equal(
  await gm
    .locator('[data-action="configure"][data-value="flight-mode"]')
    .isDisabled(),
  true,
);
assert.match(await gm.locator(".configuration").first().innerText(), /Boost/);
// Fire once as GM, once as player. The real Dice+ bridge is used against a
// protocol fixture; physical dice and service-side audience routing need a room.
for (const panel of [gm, player]) {
  await panel.locator('[data-station-panel="1"] > summary').click();
  await panel.locator('[data-action="roll"][data-value="fire"]').click();
  await panel
    .locator(".notice")
    .getByText("Roll complete.", { exact: false })
    .waitFor();
}
const rolls = await page.evaluate(() => window.rollRequests);
assert.deepEqual(
  rolls.map((r) => r.rollTarget),
  ["gm_only", "everyone"],
);
assert.ok(
  rolls.every(
    (r) => r.diceNotation.includes("kl") && r.diceNotation.includes("#Damage"),
  ),
);
// Persisted player state reloads from scene; private NPC data stays local.
await gm.getByRole("button", { name: "Ships", exact: true }).first().click();
await gm.locator("#ship-select").selectOption("shrike");
await gm.getByRole("button", { name: "Status", exact: true }).click();
await gm.getByRole("button", { name: "Damage Engines", exact: true }).click();
await gm.locator(".notice").getByText("Saved.", { exact: true }).waitFor();
assert.equal(
  await page.evaluate(() => JSON.stringify(window.metadata).includes("shrike")),
  false,
);
const local = await page.evaluate(() =>
  JSON.parse(
    localStorage.getItem("com.ddotts.crowbear.spaceship-combat/gm/qa-room"),
  ),
);
assert.equal(local.ships.find((s) => s.id === "shrike").parts[1].damage, 1);
assert.equal(
  await page.evaluate(() =>
    window.remotePayloads.some((s) => s.includes("shrike")),
  ),
  false,
);
// A library import is local to the GM, while player-ship changes are shared.
await gm.getByRole("button", { name: "Import", exact: true }).click();
await gm.getByRole("button", { name: "Example JSON", exact: true }).click();
const library = JSON.parse(await gm.locator("#json").inputValue());
library.ships.find((s) => s.id === "shrike").name =
  "SECRET NPC <img src=x onerror=window.compromised=true>";
library.ships.find(
  (s) => s.id === "kestrel",
).parts[0].levels[0][0].description =
  "**Safe Markdown** <script>window.compromised=true</script><img src=x onerror=window.compromised=true> [bad](javascript:alert(1))";
await gm.locator("#json").fill(JSON.stringify(library));
await gm.getByRole("button", { name: "Preview import", exact: true }).click();
await gm.getByRole("button", { name: "Import library", exact: true }).click();
await gm
  .locator(".notice")
  .getByText("Library imported.", { exact: true })
  .waitFor();
assert.equal(
  await page.evaluate(() =>
    window.remotePayloads.some((s) => s.includes("SECRET NPC")),
  ),
  false,
);
await player.getByRole("button", { name: "Status", exact: true }).click();
await player
  .locator(".effect-list .description")
  .first()
  .locator("summary")
  .click();
assert.equal(
  await player
    .locator(
      ".effect-list .markdown script,.effect-list .markdown img,.effect-list .markdown a[href^='javascript:']",
    )
    .count(),
  0,
);
assert.equal(
  await page.frame({ name: "player" }).evaluate(() => window.compromised),
  undefined,
);
// An unavailable GM browser store must fail visibly and retain the old state.
const background = page.frame({ name: "gm-background" });
await background.evaluate(() => {
  window.originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = () => {
    throw new Error("Private storage full");
  };
});
await gm.getByRole("button", { name: "Ships", exact: true }).first().click();
await gm.locator("#ship-select").selectOption("shrike");
await gm.getByRole("button", { name: "Status", exact: true }).click();
await gm.getByRole("button", { name: "Damage Engines", exact: true }).click();
await gm
  .locator(".notice")
  .getByText("Private storage full", { exact: true })
  .waitFor();
await background.evaluate(() => {
  Storage.prototype.setItem = window.originalSetItem;
});
assert.equal(
  await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem("com.ddotts.crowbear.spaceship-combat/gm/qa-room"),
      ).ships.find((s) => s.id === "shrike").parts[1].damage,
  ),
  1,
);
// Save failures must be visible, and not change either the accepted shared state
// or the GM library for the failed transaction.
await page.evaluate(() => (window.failSave = true));
await player.getByRole("button", { name: "Status", exact: true }).click();
await player
  .getByRole("button", { name: "Repair Engines", exact: true })
  .click();
await player
  .locator(".notice")
  .getByText("Simulated scene save failure", { exact: true })
  .waitFor();
assert.equal(
  await page.evaluate(
    () => Object.values(window.metadata)[0].ships[0].parts[1].damage,
  ),
  2,
);
await page.evaluate(() => (window.failSave = false));
await page.screenshot({ path: "/tmp/crowbear-room-fixture.png" });
await player.getByRole("button", { name: "Stations", exact: true }).click();
await player
  .locator('[data-action="configure"][data-value="target-mode"]')
  .click();
await player.locator('[data-form="effects"]').waitFor();
await page.evaluate(() => window.switchScene(false));
await player
  .locator(".connection-status")
  .getByText("Open a scene", { exact: false })
  .waitFor();
assert.equal(await player.locator(".stats-strip").count(), 0);
await page.evaluate(() => window.switchScene(true));
await player.locator(".ship-heading h2").waitFor();
assert.equal(
  await page.evaluate(
    () => Object.values(window.metadata)[0].ships[0].parts[1].damage,
  ),
  0,
);
assert.equal(await player.locator('[data-form="effects"]').count(), 0);
assert.deepEqual(errors, []);
console.log(
  "SDK room fixture passed: background controller, two-player serialization, private GM storage, scene changes, theme, Dice+ audiences, effect persistence and save errors.",
);
await browser.close();
