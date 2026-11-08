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
window.metadata={};window.rollRequests=[];window.remotePayloads=[];window.failSave=false;window.sceneReady=true;window.holdRoll=false;window.releaseRoll=null;
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
 case 'OBR_SCENE_SET_METADATA':if(window.failSave){error=typeof window.failSave==='object'?window.failSave:'Simulated scene save failure';break;}Object.assign(window.metadata,m.data.update);emit('OBR_SCENE_METADATA_EVENT_CHANGE',{metadata:window.metadata});break;
 case 'OBR_PARTY_GET_PLAYERS':response={players:[...new Map(clients.filter(c=>c.connection!==client.connection).map(c=>[c.connection,{id:c.user,connectionId:c.connection,role:c.role}])).values()]};break;
 case 'OBR_THEME_GET_THEME':response={theme:{mode:'DARK',primary:{main:'#bb99ff',contrastText:'#25143d',light:'#ddccff',dark:'#8855cc'},secondary:{main:'#ffcc88',contrastText:'#000',light:'#ffeedd',dark:'#bb8844'},background:{default:'#18181f',paper:'#252530'},text:{primary:'#eeeeee',secondary:'#b7b5c2',disabled:'#777'}}};break;
 case 'OBR_BROADCAST_SUBSCRIBE':client.channels.add(m.data.channel);break;
 case 'OBR_BROADCAST_UNSUBSCRIBE':client.channels.delete(m.data.channel);break;
 case 'OBR_BROADCAST_SEND_MESSAGE':{
   const {channel,data,options}=m.data;broadcast(client,channel,data,options?.destination);
   const dice={connection:'dice-service'};
   if(channel==='dice-plus/isReady' && !data.ready)broadcast(dice,channel,{requestId:data.requestId,ready:true,timestamp:Date.now()},'ALL');
   if(channel==='dice-plus/validate-notation' && data.valid===undefined)broadcast(dice,channel,{requestId:data.requestId,notation:data.notation,valid:true,timestamp:Date.now()},'ALL');
   if(channel==='dice-plus/roll-request'){window.rollRequests.push(data);const reply=()=>broadcast(dice,data.source+'/roll-result',{rollId:data.rollId,playerId:data.playerId,playerName:data.playerName,rollTarget:data.rollTarget,timestamp:data.timestamp,result:{rollId:data.rollId,diceNotation:data.diceNotation,totalValue:12,rollSummary:'Fixture result',groups:[]}},'ALL');if(window.holdRoll)window.releaseRoll=reply;else reply();}
   break;
 }
 default:break;
 }
 if(m.nonce)send(client,m.id+(error?'_ERROR':'_RESPONSE')+m.nonce,error??response);
});
for(const [name,connection,user,role,background] of [['gm-background','gm-tab','gm-user','GM',true],['gm','gm-tab','gm-user','GM',false],['player','player-tab','player-user','PLAYER',false],['player-two','player-two-tab','player-two-user','PLAYER',false]]){
 const frame=document.createElement('iframe');frame.name=name;frame.allow='clipboard-write';frame.style=background?'display:none':'width:400px;height:640px;border:0;border-radius:12px;';
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
await player
  .locator(".connection-status")
  .getByText("Scene connected", { exact: false })
  .waitFor();
await player
  .getByRole("button", { name: "Ships", exact: true })
  .first()
  .click();
await second
  .getByRole("button", { name: "Ships", exact: true })
  .first()
  .click();
await player.locator(".ship-heading h2").waitFor();
// Choose the observed ship explicitly: the GM can load its private fleet before
// scene initialization, so its initial selection may be an NPC.
await gm.getByRole("button", { name: "Ships", exact: true }).first().click();
await gm.locator("#ship-select").selectOption("kestrel");
await gm.getByRole("button", { name: "Run", exact: true }).click();
assert.equal(await gm.locator(".initiative-entry").count(), 5);
await gm
  .getByRole("spinbutton", { name: "Initiative for Mara Voss", exact: true })
  .fill("25");
await gm
  .getByRole("spinbutton", { name: "Initiative for Mara Voss", exact: true })
  .press("Tab");
await page.waitForFunction(
  () =>
    Object.values(window.metadata)[0].crew.find((c) => c.id === "mara")
      .initiative === 25,
);
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
// Hit rolls consume a station-wide cooldown; effect rolls stay available.
for (const panel of [gm, player]) {
  await panel.locator('[data-station-panel="1"] > summary').click();
}
const hit = '[data-action="roll"][data-value="fire"][data-roll-index="0"]';
const effect = '[data-action="roll"][data-value="fire"][data-roll-index="1"]';
await gm.locator(hit).click();
await gm
  .locator(".notice")
  .getByText("Roll complete.", { exact: false })
  .waitFor();
await page.waitForFunction(
  () =>
    Object.values(
      window.metadata,
    )[0]?.ships[0].stations[1].cooldowns.fire?.join(",") === "3,0",
);
assert.equal(await player.locator(hit).getAttribute("aria-disabled"), "false");
await player.locator(hit).click();
await page.waitForFunction(
  () =>
    Object.values(window.metadata)[0].ships[0].stations[1].cooldowns.fire?.join(
      ",",
    ) === "3,4",
);
assert.equal(await player.locator(hit).getAttribute("aria-disabled"), "true");
assert.equal(
  await player.locator(effect).getAttribute("aria-disabled"),
  "false",
);
await player.locator(hit).click({ button: "right", force: true });
await player.getByRole("button", { name: "normal", exact: true }).click();
await player
  .locator(".notice")
  .getByText("Roll complete.", { exact: false })
  .waitFor();
await player.locator(effect).click();
await page.waitForFunction(() => window.rollRequests.length === 4);
await player
  .locator(".notice")
  .getByText("Roll complete.", { exact: false })
  .waitFor();
const rolls = await page.evaluate(() => window.rollRequests);
assert.deepEqual(
  rolls.map((r) => r.rollTarget),
  ["gm_only", "everyone", "everyone", "everyone"],
);
assert.deepEqual(
  rolls.map((r) => r.diceNotation),
  ["3d6kl2+2#Hit", "3d6kl2+2#Hit", "2d6+2#Hit", "1d6-1#Damage"],
);
assert.deepEqual(
  await page.evaluate(
    () => Object.values(window.metadata)[0].ships[0].stations[1].cooldowns.fire,
  ),
  [3, 4],
);
// Batch initiative uses local RNG, individual initiative uses Dice+ totals.
await gm.getByRole("button", { name: "Run", exact: true }).click();
await gm
  .getByRole("button", { name: "Roll NPC initiatives · RNG", exact: true })
  .click();
await gm
  .locator(".notice")
  .getByText("Rolled 2 NPC initiatives with RNG.", { exact: true })
  .waitFor();
assert.equal(await page.evaluate(() => window.rollRequests.length), 4);
assert.equal(await gm.locator('.crew-order [data-action="actor"]').count(), 5);
assert.equal(
  await gm
    .getByRole("spinbutton", { name: "Initiative for Mara Voss", exact: true })
    .inputValue(),
  "25",
);
assert.equal(await gm.locator('.crew-order [aria-current="step"]').count(), 1);
const active = await gm
  .locator('.crew-order [aria-current="step"]')
  .getAttribute("data-value");
await gm.getByRole("button", { name: "Next →", exact: true }).click();
await page.waitForFunction(
  (prior) =>
    document
      .querySelector('iframe[name="gm"]')
      .contentDocument.querySelector('.crew-order [aria-current="step"]')
      ?.dataset.value !== prior,
  active,
);

assert.notEqual(
  await gm
    .locator('.crew-order [aria-current="step"]')
    .getAttribute("data-value"),
  active,
);
await gm.getByRole("button", { name: "← Back", exact: true }).click();
await page.waitForFunction(
  (prior) =>
    document
      .querySelector('iframe[name="gm"]')
      .contentDocument.querySelector('.crew-order [aria-current="step"]')
      ?.dataset.value === prior,
  active,
);

assert.equal(
  await gm
    .locator('.crew-order [aria-current="step"]')
    .getAttribute("data-value"),
  active,
);
for (const direction of ["Next →", "Next →", "← Back", "← Back"]) {
  const previous = await gm
    .locator('.crew-order [aria-current="step"]')
    .getAttribute("data-value");
  await gm.getByRole("button", { name: direction, exact: true }).click();
  await page.waitForFunction(
    (prior) =>
      document
        .querySelector('iframe[name="gm"]')
        .contentDocument.querySelector('.crew-order [aria-current="step"]')
        ?.dataset.value !== prior,
    previous,
  );
  await gm.locator("main:not([inert])").waitFor();
  assert.equal(
    await gm.locator(".crew-order").evaluate((el) => {
      const outer = el.getBoundingClientRect(),
        inner = el
          .querySelector('[aria-current="step"]')
          .getBoundingClientRect();
      return inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
    }),
    true,
  );
}
await gm.locator('[data-action="actor"][data-value="ivo"]').click();
assert.equal(await gm.locator('.crew-order [aria-pressed="true"]').count(), 3);
assert.equal(await gm.locator(".crew-actions .ship-snapshot").count(), 1);
assert.equal(await gm.locator(hit).count(), 1);

await gm.getByRole("button", { name: "Round +1", exact: true }).click();
await page.waitForFunction(
  () =>
    Object.values(window.metadata)[0].ships[0].stations[1].cooldowns.fire?.join(
      ",",
    ) === "2,3",
);
await gm.getByRole("button", { name: "Edit", exact: true }).click();
await gm.locator("#encounter-name").fill("Relay — crew turns");
await gm.getByRole("button", { name: "Save encounter", exact: true }).click();
await gm.locator(".notice").getByText("Saved.", { exact: true }).waitFor();
const savedEncounter = await page.evaluate(() =>
  JSON.parse(
    localStorage.getItem("com.ddotts.crowbear.spaceship-combat/gm/qa-room"),
  ).encounters.find((e) => e.id === "relay"),
);
assert.equal(savedEncounter.round, 2);
assert.equal(savedEncounter.cooldownRound, 2);
await player.getByRole("button", { name: "Actions", exact: true }).click();
await player.locator("#crew-self").selectOption("ivo");
assert.equal(await player.locator(hit).getAttribute("aria-disabled"), "true");
await player
  .getByRole("button", { name: "Roll initiative", exact: true })
  .click();
await page.waitForFunction(
  () =>
    Object.values(window.metadata)[0].crew.find((c) => c.id === "ivo")
      .initiative === 12,
);
await player.getByRole("button", { name: "Switch seat", exact: true }).click();
await player.locator('[data-form="move"]').waitFor();
await page.screenshot({ path: "/tmp/crowbear-crew-actions.png" });
await player.locator("#destination").selectOption("kestrel:1:1");
await player.locator('[data-form="move"] button.primary').click();
await page.waitForFunction(
  () =>
    Object.values(window.metadata)[0].ships[0].stations[1].seats[1] === "ivo",
);
assert.deepEqual(
  await page.evaluate(
    () => Object.values(window.metadata)[0].ships[0].stations[1].cooldowns.fire,
  ),
  [2, 3],
);

await player
  .getByRole("button", { name: "Ships", exact: true })
  .first()
  .click();
// Simultaneous seats cannot dispatch two normal hits from the same station.
await gm.getByRole("button", { name: "Round +1", exact: true }).click();
await gm.getByRole("button", { name: "Round +1", exact: true }).click();
await page.waitForFunction(
  () =>
    Object.values(window.metadata)[0].ships[0].stations[1].cooldowns.fire?.join(
      ",",
    ) === "0,1",
);
await second.getByRole("button", { name: "Stations", exact: true }).click();
await second.locator('[data-station-panel="1"] > summary').click();
await Promise.all([player.locator(hit).click(), second.locator(hit).click()]);
await page.waitForFunction(() => window.rollRequests.length === 6);
await page.waitForFunction(() =>
  [...document.querySelectorAll("iframe")]
    .filter((f) => f.name.startsWith("player"))
    .some((f) =>
      f.contentDocument
        .querySelector(".notice")
        ?.textContent.includes("on cooldown"),
    ),
);
assert.equal(await page.evaluate(() => window.rollRequests.length), 6);
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
library.ships
  .find((s) => s.id === "kestrel")
  .stations[1].actions.find((a) => a.id === "target-mode")
  .effects.find((e) => e.id === "focus").duration = {
  unit: "crewTurns",
  count: 1,
};
library.ships
  .find((s) => s.id === "kestrel")
  .ammunition.find((pool) => pool.name === "Torpedoes").current = 1;
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
  .locator(".effect-list .effect-entry")
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
assert.equal(
  JSON.parse(await gm.locator("#save-diagnostic-report").inputValue()).stage,
  "save GM browser storage",
);
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
await player.getByRole("button", { name: "Stations", exact: true }).click();
if (
  (await player.locator('[data-station-panel="1"]').getAttribute("open")) ===
  null
)
  await player.locator('[data-station-panel="1"] > summary').click();
await player
  .getByRole("button", { name: "Use Launch torpedo", exact: true })
  .click();
await player
  .locator(".notice")
  .getByText("Simulated scene save failure", { exact: true })
  .waitFor();
assert.equal(
  await page.evaluate(
    () =>
      Object.values(window.metadata)[0].ships[0].ammunition.find(
        (pool) => pool.name === "Torpedoes",
      ).current,
  ),
  1,
);
assert.equal(
  await page.evaluate(
    () =>
      Object.values(window.metadata)[0].ships[0].stations[1].cooldowns[
        "named:launchers"
      ],
  ),
  undefined,
);
await page.evaluate(() => (window.failSave = false));
await page.screenshot({ path: "/tmp/crowbear-room-fixture.png" });
const beforeAmmoRolls = await page.evaluate(() => window.rollRequests.length);
for (const panel of [player, second]) {
  await panel.getByRole("button", { name: "Stations", exact: true }).click();
  if (
    (await panel.locator('[data-station-panel="1"]').getAttribute("open")) ===
    null
  )
    await panel.locator('[data-station-panel="1"] > summary').click();
}
await Promise.all(
  [player, second].map((panel) =>
    panel
      .getByRole("button", { name: "Use Launch torpedo", exact: true })
      .dispatchEvent("click"),
  ),
);
await page.waitForFunction(
  () =>
    Object.values(window.metadata)[0].ships[0].ammunition.find(
      (pool) => pool.name === "Torpedoes",
    ).current === 0,
);
await player.locator("main:not([inert])").waitFor();
await second.locator("main:not([inert])").waitFor();
assert.equal(
  await page.evaluate(() => window.rollRequests.length),
  beforeAmmoRolls,
);
assert.equal(
  await player
    .getByRole("button", { name: "Use Launch torpedo", exact: true })
    .isDisabled(),
  true,
);
await player
  .getByRole("button", { name: "Roll Launch torpedo hit", exact: true })
  .click();
await page.waitForFunction(
  (n) => window.rollRequests.length === n + 1,
  beforeAmmoRolls,
);
await player
  .locator(".notice")
  .getByText("Roll complete.", { exact: false })
  .waitFor();
await player
  .getByRole("button", { name: "Roll Launch torpedo effect", exact: true })
  .click();
await page.waitForFunction(
  (n) => window.rollRequests.length === n + 2,
  beforeAmmoRolls,
);
assert.equal(
  await page.evaluate(
    () =>
      Object.values(window.metadata)[0].ships[0].ammunition.find(
        (pool) => pool.name === "Torpedoes",
      ).current,
  ),
  0,
);
await page.screenshot({ path: "/tmp/crowbear-ammunition-room.png" });

await player.getByRole("button", { name: "Stations", exact: true }).click();
await player
  .locator('[data-action="configure"][data-value="target-mode"]')
  .click();
await player.locator('[data-form="effects"]').waitFor();
await player.locator('[data-form="effects"] input[value="focus"]').check();
await player
  .getByRole("button", { name: "Apply effects", exact: true })
  .click();
await page.waitForFunction(
  () =>
    Object.values(window.metadata)[0].ships[0].effectStates[
      "station:weapons:target-mode:focus"
    ]?.remaining === 1,
);
assert.equal(
  await player
    .getByRole("button", { name: "Roll Focused burst hit", exact: true })
    .getAttribute("aria-disabled"),
  "false",
);
await gm.getByRole("button", { name: "Run", exact: true }).click();
for (let i = 0; i < 4; i++) {
  await gm.getByRole("button", { name: "Next →", exact: true }).click();
  await gm.locator("main:not([inert])").waitFor();
  const current = await gm
    .locator('.crew-order [aria-current="step"]')
    .getAttribute("data-value");
  if (current === "ivo") break;
}
await page.waitForFunction(
  () =>
    !Object.values(window.metadata)[0].ships[0].stations[1].selectedEffects[
      "target-mode"
    ].includes("focus"),
);
await player
  .locator(
    '[data-action="roll"][data-value="focused-burst"][aria-disabled="true"]',
  )
  .waitFor();
await player
  .locator('[data-action="configure"][data-value="target-mode"]')
  .click();
await player.locator('[data-form="effects"]').waitFor();
// A player-applied effect persists in shared metadata and changes another panel's damage.
await player.getByRole("button", { name: "Actions", exact: true }).click();
await player.locator("#crew-self").selectOption("mara");
await player.getByRole("button", { name: "Switch seat", exact: true }).click();
await player.locator("#destination").selectOption("kestrel:0:0");
await player.locator('[data-form="move"] button.primary').click();
await page.waitForFunction(
  () =>
    Object.values(window.metadata)[0].ships[0].stations[0].seats[0] === "mara",
);
assert.equal(
  await player
    .locator('[aria-label="Target ship for Guided fire"] option')
    .count(),
  0,
);
const beforeSelectionRoll = await page.evaluate(() => {
  window.holdRoll = true;
  return window.rollRequests.length;
});
await player
  .getByRole("button", { name: "Use Guided fire", exact: true })
  .click();
await page.waitForFunction(
  (n) => window.rollRequests.length > n && Boolean(window.releaseRoll),
  beforeSelectionRoll,
);
assert.equal(await player.locator("#target-ship-choice").count(), 0);
assert.equal(
  await page.evaluate(
    () =>
      Object.values(window.metadata)[0].ships[0].stations[0].cooldowns
        .support[0],
  ),
  2,
);
assert.equal(
  await page.evaluate(
    () => Object.values(window.metadata)[0].ships[0].pendingSelections.length,
  ),
  1,
);
await page.evaluate(() => {
  window.holdRoll = false;
  window.releaseRoll();
  window.releaseRoll = null;
});
await player.locator("#target-ship-choice").selectOption("kestrel");
await player
  .getByRole("button", { name: "Apply effects", exact: true })
  .click();
await page.waitForFunction(() =>
  Object.values(window.metadata)[0].ships[0].receivedEffects?.some(
    (entry) => entry.effect.id === "guided-fire",
  ),
);
// Removal also rolls and spends first; cancelling preserves both the effect and costs.
const beforeRemoval = await page.evaluate(() => {
  const ship = Object.values(window.metadata)[0].ships[0];
  return {
    ammo: ship.ammunition.find((p) => p.name === "Autonomy").current,
    damage: ship.parts[2].damage,
  };
});
await player
  .getByRole("button", { name: "Use Clear fault", exact: true })
  .click();
await player.locator("#remove-effect-choice").waitFor();
assert.equal(
  await page.evaluate(
    () =>
      Object.values(window.metadata)[0].ships[0].ammunition.find(
        (p) => p.name === "Autonomy",
      ).current,
  ),
  beforeRemoval.ammo - 1,
);
await player.getByRole("button", { name: "Cancel", exact: true }).click();
await player.locator("#remove-effect-choice").waitFor({ state: "detached" });
assert.equal(
  await page.evaluate(
    () =>
      Object.values(window.metadata)[0].ships[0].ammunition.find(
        (p) => p.name === "Autonomy",
      ).current,
  ),
  beforeRemoval.ammo - 1,
);
assert.equal(
  await page.evaluate(
    () => Object.values(window.metadata)[0].ships[0].parts[2].damage,
  ),
  beforeRemoval.damage,
);
assert.equal(
  await page.evaluate(
    () => Object.values(window.metadata)[0].ships[0].pendingSelections.length,
  ),
  0,
);
await second.getByRole("button", { name: "Actions", exact: true }).click();
await second.locator("#crew-self").selectOption("ivo");
const catRoll = second.getByRole("button", {
  name: "Roll Fire cannons effect",
  exact: true,
});
await catRoll.locator(".cat-label").filter({ hasText: "CAT1" }).waitFor();
const beforeCatRoll = await page.evaluate(() => window.rollRequests.length);
await catRoll.click();
await page.waitForFunction(
  (n) => window.rollRequests.length > n,
  beforeCatRoll,
);
assert.match(
  await page.evaluate(() => window.rollRequests.at(-1).diceNotation),
  /1d4/,
);
await catRoll.click({ button: "right" });
await second.getByRole("button", { name: "Worsen", exact: true }).click();
await second.getByRole("button", { name: "normal", exact: true }).click();
await page.waitForFunction(
  (n) => window.rollRequests.length > n + 1,
  beforeCatRoll,
);
assert.match(
  await page.evaluate(() => window.rollRequests.at(-1).diceNotation),
  /1d6/,
);
assert.equal(
  await page.evaluate(() => window.rollRequests.at(-1).rollTarget),
  "everyone",
);
await player.getByRole("button", { name: "Ships", exact: true }).click();
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
// A replacement import removes the starter scene fleet and private GM library in every panel.
await gm.getByRole("button", { name: "Import", exact: true }).click();
assert.equal(await gm.locator("#import-mode").inputValue(), "replace");
const replacementLibrary = await page.evaluate(() => {
  const shared = Object.values(window.metadata)[0];
  const ship = structuredClone(shared.ships[0]);
  ship.id = "sdk-ship";
  ship.name = "Imported SDK ship";
  for (const station of ship.stations)
    station.seats = station.seats.map(() => null);
  ship.stations[0].seats[0] = "sdk-crew";
  const crew = {
    ...structuredClone(shared.crew[0]),
    id: "sdk-crew",
    ship: ship.id,
  };
  return {
    version: 1,
    ships: [ship],
    crew: [crew],
    encounters: [
      {
        id: "sdk-encounter",
        name: "Imported SDK encounter",
        shipIds: [ship.id],
        round: 1,
        turn: 0,
        currentCrewId: null,
        running: true,
      },
    ],
  };
});
await gm.locator("#json").fill(JSON.stringify(replacementLibrary));
await gm.getByRole("button", { name: "Preview import", exact: true }).click();
await page.evaluate(
  () =>
    (window.failSave = {
      name: "SDKSaveError",
      message: "Fixture structured scene save failure",
      code: "FIXTURE_SCENE_SAVE",
    }),
);
await gm.getByRole("button", { name: "Import library", exact: true }).click();
await gm
  .locator(".notice")
  .getByText("Fixture structured scene save failure [FIXTURE_SCENE_SAVE]", {
    exact: true,
  })
  .waitFor();
const reportText = await gm.locator("#save-diagnostic-report").inputValue();
const report = JSON.parse(reportText);
assert.equal(report.stage, "save Owlbear scene metadata");
assert.equal(report.operation, "import");
assert.equal(report.importMode, "replace");
assert.equal(report.rollback, "GM browser storage restored");
assert.equal(report.errorType, "SDKSaveError");
assert.match(report.error, /FIXTURE_SCENE_SAVE/);
assert.ok(
  report.commandBytes > 0 &&
    report.sharedBytes > 0 &&
    report.metadataUpdateBytes > report.sharedBytes &&
    report.gmBytes > 0,
);
assert.deepEqual(report.importCounts, { ships: 1, crew: 1, encounters: 1 });
assert.equal(reportText.includes("SECRET NPC"), false);
assert.equal(reportText.includes("stations"), false);
await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
await gm.getByRole("button", { name: "Copy diagnostics", exact: true }).click();
await gm
  .locator(".notice")
  .getByText("Diagnostics copied.", { exact: true })
  .waitFor();
assert.equal(
  await page.evaluate(() => navigator.clipboard.readText()),
  reportText,
);
await page.screenshot({ path: "/tmp/crowbear-import-diagnostics-room.png" });
await page
  .locator('iframe[name="gm"]')
  .screenshot({ path: "/tmp/crowbear-import-diagnostics-400.png" });
await page.locator('iframe[name="gm"]').evaluate((frame) => {
  frame.style.width = "320px";
  frame.style.height = "560px";
});
await gm
  .getByRole("button", { name: "Copy diagnostics", exact: true })
  .scrollIntoViewIfNeeded();
await page
  .locator('iframe[name="gm"]')
  .screenshot({ path: "/tmp/crowbear-import-diagnostics-320.png" });
assert.equal(
  await gm.locator("main").evaluate((el) => el.scrollWidth > el.clientWidth),
  false,
);
await page.locator('iframe[name="gm"]').evaluate((frame) => {
  frame.style.width = "400px";
  frame.style.height = "640px";
});
console.log(
  "Structured SDK import failures retain stage, payload sizes, cause, rollback and copyable diagnostics.",
);
await page.evaluate(() => (window.failSave = false));
await gm.getByRole("button", { name: "Import library", exact: true }).click();
await gm
  .locator(".notice")
  .getByText("Library imported.", { exact: true })
  .waitFor();
await page.waitForFunction(
  () => Object.values(window.metadata)[0].ships[0]?.id === "sdk-ship",
);
assert.equal(await gm.locator("#save-diagnostic-report").count(), 0);
assert.deepEqual(
  await page.evaluate(() =>
    Object.values(window.metadata)[0].ships.map((ship) => ship.id),
  ),
  ["sdk-ship"],
);
assert.deepEqual(
  await page.evaluate(() =>
    Object.values(window.metadata)[0].crew.map((crew) => crew.id),
  ),
  ["sdk-crew"],
);
const replacedGm = await page.evaluate(() =>
  JSON.parse(
    localStorage.getItem("com.ddotts.crowbear.spaceship-combat/gm/qa-room"),
  ),
);
assert.deepEqual(replacedGm.ships, []);
assert.deepEqual(replacedGm.crew, []);
assert.equal(replacedGm.encounters.length, 1);
assert.equal(replacedGm.activeEncounterId, "sdk-encounter");
for (const panel of [player, second]) {
  await panel.getByRole("button", { name: "Ships", exact: true }).click();
  assert.equal(await panel.locator("#ship-select option").count(), 1);
  assert.match(
    await panel.locator("#ship-select").textContent(),
    /Imported SDK ship/,
  );
}
assert.deepEqual(errors, []);
console.log(
  "SDK room fixture passed: background controller, two-player serialization, private GM storage, scene changes, theme, Dice+ audiences, split rolls, independent cooldown slots, backward initiative, NPC batch/manual totals, tracker scrolling/colours, ammunition concurrency, crew quick actions/status, effect persistence and save errors.",
);
await browser.close();
